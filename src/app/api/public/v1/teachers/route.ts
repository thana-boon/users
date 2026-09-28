import type { NextRequest } from 'next/server';
import { and, asc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { academicYears, homeroomTeachers, teachers } from '@/db/schema';
import { requireApiScope, actorHasScope, apiError, insufficientScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { resolveActiveYearId } from '@/lib/services/students';
import {
  PUBLIC_TEACHER_COLUMNS,
  noQualifications,
  readQualificationsFor,
  shapePublicTeacher,
  type PublicQualifications,
} from '@/lib/services/teachers';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/teachers — staff roster feed for other SchoolOS systems.
 *
 * Auth: `teachers:read`; เลขบัตร ปชช. needs the additive `teachers:pii`.
 * password_encrypted is never returned; photo_base64 is never returned *here*
 * (see the students route for the reasoning) — photos come from ./[id]/photo or
 * ./photos?ids= under the additive `teachers:photo` scope, and `hasPhoto`/
 * `photoUrl` below say who has one.
 *
 * `role` is exposed because it is what sibling systems authorize against —
 * `teacher-admin` is the module's source of truth for who holds users:write.
 *
 * Each row carries `homerooms` — the rooms this teacher is ครูประจำชั้น of in
 * the requested year (`?yearId=`, default: active year). Additive field; the
 * room-centric view lives at /api/public/v1/homerooms.
 *
 * `?include=qualifications` adds วุฒิการศึกษา / วุฒิลูกเสือ / การผ่านอบรม to each
 * row. Opt-in rather than always on: they are three extra queries and can be a
 * dozen rows per teacher, and the common "มาดึงรายชื่อไป" integration wants
 * neither. They ride the plain `teachers:read` scope — a professional
 * qualification is a credential the school publishes, not personal data like
 * เลขบัตร ปชช. For one teacher with the lists always included, see ./[id].
 *
 * `?include=contact` adds a `contact` block — ผู้ติดต่อฉุกเฉิน (ชื่อ/เบอร์/
 * ความเกี่ยวข้อง) and ที่อยู่ตามทะเบียนบ้าน — behind the additive
 * `teachers:contact` scope (403 without it, like students' `contact`). Audited.
 *
 * `?updatedSince=<ISO datetime>` returns only teachers whose row changed at or
 * after that instant, so a sync can pull deltas instead of the whole staff.
 * Rows carry `updatedAt` for the caller to remember. (Row-level only: editing
 * nothing but a qualification list does not move it — see ./[id] for those.)
 *
 * Query: ?subjectGroup= ?role= ?status= ?q= ?yearId= ?include= ?updatedSince=
 *        ?page= ?pageSize= (max 200)
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'teachers:read');
  if (!guard.ok) return guard.response;

  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const subjectGroup = (sp.get('subjectGroup') ?? '').trim();
    const role = (sp.get('role') ?? '').trim();
    const status = (sp.get('status') ?? 'active').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize') ?? '50') || 50));
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    // Comma-separated, so more opt-in blocks can be added later without a new
    // parameter each time.
    const include = new Set(
      (sp.get('include') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    );
    const withQualifications = include.has('qualifications');
    const withContact = include.has('contact');
    if (withContact && !actorHasScope(guard.actor, 'teachers:contact')) {
      return insufficientScope('teachers:contact');
    }

    const withPii = actorHasScope(guard.actor, 'teachers:pii');

    const updatedSinceRaw = (sp.get('updatedSince') ?? '').trim();
    const updatedSince = updatedSinceRaw ? new Date(updatedSinceRaw) : null;
    if (updatedSince && Number.isNaN(updatedSince.getTime())) {
      return apiError(400, 'invalid_query', 'updatedSince ต้องเป็นวันเวลาแบบ ISO เช่น 2026-09-01T00:00:00+07:00');
    }

    const conds = [eq(teachers.isArchived, false)];
    if (subjectGroup) conds.push(eq(teachers.subjectGroup, subjectGroup));
    if (role === 'teacher' || role === 'teacher-admin') conds.push(eq(teachers.role, role));
    if (status !== 'all' && (status === 'active' || status === 'resigned')) {
      conds.push(eq(teachers.employmentStatus, status));
    }
    if (updatedSince) conds.push(gte(teachers.updatedAt, updatedSince));
    if (q) {
      conds.push(
        or(
          ilike(teachers.firstName, `%${q}%`),
          ilike(teachers.lastName, `%${q}%`),
          ilike(teachers.teacherCode, `%${q}%`),
          ilike(teachers.email, `%${q}%`),
        )!,
      );
    }
    const where = and(...conds);

    const [rows, countRes] = await Promise.all([
      db
        .select({
          ...PUBLIC_TEACHER_COLUMNS,
          hasPhoto: sql<boolean>`${teachers.photoBase64} is not null`,
        })
        .from(teachers)
        .where(where)
        .orderBy(asc(teachers.teacherCode))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)` }).from(teachers).where(where),
    ]);

    // Homeroom assignments of this page's teachers in the requested year.
    const ids = rows.map((r) => r.id);
    const [assignRows, yearRow] = await Promise.all([
      ids.length > 0
        ? db
            .select({
              teacherId: homeroomTeachers.teacherId,
              gradeLevel: homeroomTeachers.gradeLevel,
              classroom: homeroomTeachers.classroom,
            })
            .from(homeroomTeachers)
            .where(
              and(
                eq(homeroomTeachers.academicYearId, yearId),
                inArray(homeroomTeachers.teacherId, ids),
              ),
            )
        : Promise.resolve([]),
      db.query.academicYears.findFirst({ where: eq(academicYears.id, yearId) }),
    ]);
    const homeroomsOf = new Map<number, { gradeLevel: string; classroom: string }[]>();
    for (const a of assignRows) {
      const list = homeroomsOf.get(a.teacherId) ?? [];
      list.push({ gradeLevel: a.gradeLevel, classroom: a.classroom });
      homeroomsOf.set(a.teacherId, list);
    }

    // Three more queries, only when asked for — see ?include= above.
    const quals = withQualifications
      ? await readQualificationsFor(ids)
      : new Map<number, PublicQualifications>();

    const data = rows.map((r) => ({
      ...shapePublicTeacher(r, { withPii, withContact }),
      homerooms: homeroomsOf.get(r.id) ?? [],
      ...(withQualifications ? (quals.get(r.id) ?? noQualifications()) : {}),
    }));

    // One row per response naming every sensitive block it carried — same
    // shape as the students route. `reveal_citizen_id` only when an id went out.
    if ((withPii || withContact) && data.length > 0) {
      const blocks = [
        withPii ? 'เลขบัตรประชาชน' : null,
        withContact ? 'ผู้ติดต่อฉุกเฉิน/ที่อยู่' : null,
      ].filter(Boolean);
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: withPii ? 'reveal_citizen_id' : 'api_read',
        targetType: 'teacher',
        targetLabel: `public API · ${data.length} รายการ · ${blocks.join(' + ')}`,
        detail: `GET /api/public/v1/teachers?${sp.toString()}`,
        req,
      });
    }

    return ok({
      data,
      page,
      pageSize,
      total: Number(countRes[0]?.n ?? 0),
      // The year the `homerooms` field was resolved against (additive).
      academicYear: yearRow ? { id: yearRow.id, year: yearRow.year } : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { academicYears, homeroomTeachers, teachers } from '@/db/schema';
import { requireApiScope, actorHasScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { tryDecrypt } from '@/lib/crypto';
import { resolveActiveYearId } from '@/lib/services/students';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/teachers — staff roster feed for other SchoolOS systems.
 *
 * Auth: `teachers:read`; เลขบัตร ปชช. needs the additive `teachers:pii`.
 * password_encrypted and photo_base64 are never returned (see the students
 * route for the reasoning).
 *
 * `role` is exposed because it is what sibling systems authorize against —
 * `teacher-admin` is the module's source of truth for who holds users:write.
 *
 * Each row carries `homerooms` — the rooms this teacher is ครูประจำชั้น of in
 * the requested year (`?yearId=`, default: active year). Additive field; the
 * room-centric view lives at /api/public/v1/homerooms.
 *
 * Query: ?subjectGroup= ?role= ?status= ?q= ?yearId= ?page= ?pageSize= (max 200)
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

    const withPii = actorHasScope(guard.actor, 'teachers:pii');

    const conds = [eq(teachers.isArchived, false)];
    if (subjectGroup) conds.push(eq(teachers.subjectGroup, subjectGroup));
    if (role === 'teacher' || role === 'teacher-admin') conds.push(eq(teachers.role, role));
    if (status !== 'all' && (status === 'active' || status === 'resigned')) {
      conds.push(eq(teachers.employmentStatus, status));
    }
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
          id: teachers.id,
          teacherCode: teachers.teacherCode,
          prefix: teachers.prefix,
          firstName: teachers.firstName,
          lastName: teachers.lastName,
          email: teachers.email,
          subjectGroup: teachers.subjectGroup,
          gradeTaught: teachers.gradeTaught,
          role: teachers.role,
          employmentStatus: teachers.employmentStatus,
          citizenIdEncrypted: teachers.citizenIdEncrypted,
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

    const data = rows.map((r) => {
      const { citizenIdEncrypted, ...rest } = r;
      return {
        ...rest,
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        homerooms: homeroomsOf.get(r.id) ?? [],
        ...(withPii ? { citizenId: tryDecrypt(citizenIdEncrypted) } : {}),
      };
    });

    if (withPii && data.length > 0) {
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: 'reveal_citizen_id',
        targetType: 'teacher',
        targetLabel: `public API · ${data.length} รายการ`,
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

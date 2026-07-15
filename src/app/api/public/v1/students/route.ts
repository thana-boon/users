import type { NextRequest } from 'next/server';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments, academicYears } from '@/db/schema';
import { requireApiScope, actorHasScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { tryDecrypt } from '@/lib/crypto';
import { resolveActiveYearId } from '@/lib/services/students';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/students — roster feed for other SchoolOS systems.
 *
 * Auth: `students:read` (API key or admin session — see requireApiScope).
 * PII:  เลขบัตร ปชช. is included ONLY with the additive `students:pii` scope,
 *       and every such response is audited.
 *
 * Deliberately excluded regardless of scope: password_encrypted (no integration
 * has a reason to read login credentials) and photo_base64 (would bloat every
 * page; fetch it per-student from the module's own photo route).
 *
 * Query: ?yearId= ?grade= ?classroom= ?status= ?q= ?page= ?pageSize= (max 200)
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'students:read');
  if (!guard.ok) return guard.response;

  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    const grade = (sp.get('grade') ?? '').trim();
    const classroom = (sp.get('classroom') ?? '').trim();
    const status = (sp.get('status') ?? 'studying').trim();
    const q = (sp.get('q') ?? '').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize') ?? '50') || 50));

    const withPii = actorHasScope(guard.actor, 'students:pii');

    const conds = [eq(students.isArchived, false), eq(enrollments.academicYearId, yearId)];
    if (grade) conds.push(eq(enrollments.gradeLevel, grade));
    if (classroom) conds.push(eq(enrollments.classroom, classroom));
    // `all` intentionally spans studying/withdrawn/graduated for systems that
    // reconcile historic rosters; the default stays the current roll.
    if (status && status !== 'all') {
      if (status === 'studying' || status === 'withdrawn' || status === 'graduated') {
        conds.push(eq(students.status, status));
      }
    }
    if (q) {
      conds.push(
        or(
          ilike(students.firstName, `%${q}%`),
          ilike(students.lastName, `%${q}%`),
          ilike(students.studentCode, `%${q}%`),
        )!,
      );
    }
    const where = and(...conds);

    const [rows, countRes, yearRow] = await Promise.all([
      db
        .select({
          id: students.id,
          studentCode: students.studentCode,
          prefix: students.prefix,
          firstName: students.firstName,
          lastName: students.lastName,
          nickname: students.nickname,
          firstNameEn: students.firstNameEn,
          lastNameEn: students.lastNameEn,
          gender: students.gender,
          birthDate: students.birthDate,
          email: students.email,
          phone: students.phone,
          status: students.status,
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          classNumber: enrollments.classNumber,
          citizenIdEncrypted: students.citizenIdEncrypted,
        })
        .from(students)
        .innerJoin(enrollments, eq(enrollments.studentId, students.id))
        .where(where)
        .orderBy(asc(enrollments.gradeLevel), asc(enrollments.classroom), asc(enrollments.seqOrder))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ n: sql<number>`count(*)` })
        .from(students)
        .innerJoin(enrollments, eq(enrollments.studentId, students.id))
        .where(where),
      db.query.academicYears.findFirst({ where: eq(academicYears.id, yearId) }),
    ]);

    const data = rows.map((r) => {
      const { citizenIdEncrypted, ...rest } = r;
      return {
        ...rest,
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        ...(withPii ? { citizenId: tryDecrypt(citizenIdEncrypted) } : {}),
      };
    });

    if (withPii && data.length > 0) {
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: 'reveal_citizen_id',
        targetType: 'student',
        targetLabel: `public API · ${data.length} รายการ`,
        detail: `GET /api/public/v1/students?${sp.toString()}`,
        req,
      });
    }

    return ok({
      data,
      page,
      pageSize,
      total: Number(countRes[0]?.n ?? 0),
      academicYear: yearRow ? { id: yearRow.id, year: yearRow.year } : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

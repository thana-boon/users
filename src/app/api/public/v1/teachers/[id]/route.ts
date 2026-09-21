import type { NextRequest } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { academicYears, homeroomTeachers, teachers } from '@/db/schema';
import { requireApiScope, actorHasScope } from '@/lib/apiauth';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { tryDecrypt } from '@/lib/crypto';
import { resolveActiveYearId } from '@/lib/services/students';
import { noQualifications, readQualificationsFor } from '@/lib/services/teachers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/public/v1/teachers/{id} — one teacher, in full.
 *
 * The twin of ./students/{id}: the same row the list returns, plus the three
 * qualification lists (วุฒิการศึกษา / วุฒิทางลูกเสือ / การผ่านอบรม) always
 * included. On the list they are opt-in because they multiply the payload
 * across a page; for one teacher there is nothing to weigh.
 *
 * Auth: `teachers:read`; เลขบัตร ปชช. still needs the additive `teachers:pii`
 * and is still audited. `{id}` is the numeric id the list returns — a
 * teacherCode lookup belongs on the list (`?q=`), which already does it.
 *
 * Archived teachers are 404: they are in the trash, and a feed that kept
 * serving them would quietly resurrect people the school deleted.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiScope(req, 'teachers:read');
  if (!guard.ok) return guard.response;

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return notFound();

    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    const withPii = actorHasScope(guard.actor, 'teachers:pii');

    const [row] = await db
      .select({
        id: teachers.id,
        teacherCode: teachers.teacherCode,
        prefix: teachers.prefix,
        firstName: teachers.firstName,
        lastName: teachers.lastName,
        email: teachers.email,
        phone: teachers.phone,
        lineId: teachers.lineId,
        birthDate: teachers.birthDate,
        gender: teachers.gender,
        religion: teachers.religion,
        nationality: teachers.nationality,
        ethnicity: teachers.ethnicity,
        subjectGroup: teachers.subjectGroup,
        gradeTaught: teachers.gradeTaught,
        role: teachers.role,
        employmentStatus: teachers.employmentStatus,
        exitDate: teachers.exitDate,
        citizenIdEncrypted: teachers.citizenIdEncrypted,
        hasPhoto: sql<boolean>`${teachers.photoBase64} is not null`,
      })
      .from(teachers)
      .where(and(eq(teachers.id, id), eq(teachers.isArchived, false)))
      .limit(1);

    if (!row) return notFound();

    const [assignRows, yearRow, quals] = await Promise.all([
      db
        .select({
          gradeLevel: homeroomTeachers.gradeLevel,
          classroom: homeroomTeachers.classroom,
        })
        .from(homeroomTeachers)
        .where(
          and(
            eq(homeroomTeachers.academicYearId, yearId),
            eq(homeroomTeachers.teacherId, id),
          ),
        ),
      db.query.academicYears.findFirst({ where: eq(academicYears.id, yearId) }),
      readQualificationsFor([id]),
    ]);

    const { citizenIdEncrypted, ...rest } = row;

    if (withPii) {
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: 'reveal_citizen_id',
        targetType: 'teacher',
        targetId: id,
        targetLabel: `${row.teacherCode} ${row.firstName} ${row.lastName}`,
        detail: `GET /api/public/v1/teachers/${id}`,
        req,
      });
    }

    return ok({
      ...rest,
      fullName: `${row.prefix ?? ''}${row.firstName} ${row.lastName}`.trim(),
      homerooms: assignRows,
      photoUrl: row.hasPhoto ? `/api/public/v1/teachers/${id}/photo` : null,
      ...(withPii ? { citizenId: tryDecrypt(citizenIdEncrypted) } : {}),
      ...(quals.get(id) ?? noQualifications()),
      academicYear: yearRow ? { id: yearRow.id, year: yearRow.year } : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

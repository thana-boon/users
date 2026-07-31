import type { NextRequest } from 'next/server';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments, academicYears } from '@/db/schema';
import { requireApiScope, actorHasScope, apiError } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { tryDecrypt } from '@/lib/crypto';
import { resolveActiveYearId } from '@/lib/services/students';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/students/[id] — one student, resolved WITHOUT a year.
 *
 * This is the escape hatch from the list route's inner join. GET /students
 * joins the enrollments of one academic year, so a student who has no
 * enrollment in that year — left mid-year and was never promoted into the next
 * one — is unreachable there even with `?status=all`. A consumer holding an
 * `id` but not knowing which year the person left had no way to turn it back
 * into a name. Here the lookup is on `students.id` alone; enrollments are
 * joined in as *history*, never as a filter, so any non-archived student
 * resolves regardless of year or status.
 *
 * Since the point is the year-independent lookup, the response carries the
 * whole enrollment history too — rebuilding a student's path through the school
 * no longer means calling GET /students once per year.
 *
 * Auth: `students:read`. เลขบัตร ปชช. still requires the additive
 * `students:pii` and is audited, exactly as on the list route.
 *
 * Archived (ถังขยะ) students stay 404 here. Every other endpoint promises they
 * are gone; a by-id lookup that answered anyway would be a way around the bin
 * rather than a feature.
 *
 * `exitReason` is deliberately NOT exposed. The free-text reason a child left
 * can record family circumstances that no roster integration needs — callers
 * get the type/date/year, which is what reconciliation and document flows use.
 *
 * The photo blob is not inlined, matching the list route: `hasPhoto` /
 * `photoUrl` point at ./photo, which is gated by `students:photo`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiScope(req, 'students:read');
  if (!guard.ok) return guard.response;

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return apiError(400, 'invalid_id', 'id ต้องเป็นตัวเลข');
    }

    const withPii = actorHasScope(guard.actor, 'students:pii');

    const [rows, enrolled, activeYearId, years] = await Promise.all([
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
          exitType: students.exitType,
          exitDate: students.exitDate,
          exitAcademicYearId: students.exitAcademicYearId,
          isArchived: students.isArchived,
          citizenIdEncrypted: students.citizenIdEncrypted,
          // Same reason as the list route: never drag the base64 image out of
          // Postgres just to report whether one exists.
          hasPhoto: sql<boolean>`${students.photoBase64} is not null`,
        })
        .from(students)
        .where(eq(students.id, id))
        .limit(1),
      db
        .select({
          yearId: enrollments.academicYearId,
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          classNumber: enrollments.classNumber,
        })
        .from(enrollments)
        .where(eq(enrollments.studentId, id)),
      resolveActiveYearId(),
      // The whole table is a handful of rows, and both the active year and the
      // exit year need naming — one fetch beats a conditional lookup each.
      db
        .select({
          id: academicYears.id,
          year: academicYears.year,
          startDate: academicYears.startDate,
          endDate: academicYears.endDate,
          term1Start: academicYears.term1Start,
          term1End: academicYears.term1End,
          term2Start: academicYears.term2Start,
          term2End: academicYears.term2End,
        })
        .from(academicYears)
        .orderBy(asc(academicYears.year)),
    ]);

    const row = rows[0];
    if (!row || row.isArchived) return apiError(404, 'not_found', 'ไม่พบนักเรียนรายนี้');

    const yearById = new Map(years.map((y) => [y.id, y]));
    // Newest first: the most recent placement is what a caller resolving a
    // stale id almost always wants, and it makes [0] a useful default.
    const history = enrolled
      .map((e) => ({ ...e, year: yearById.get(e.yearId)?.year ?? null }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

    const current = history.find((e) => e.yearId === activeYearId) ?? null;
    const exitYear = row.exitAcademicYearId ? yearById.get(row.exitAcademicYearId) : undefined;

    const { citizenIdEncrypted, isArchived, exitType, exitDate, exitAcademicYearId, ...core } = row;

    if (withPii) {
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: 'reveal_citizen_id',
        targetType: 'student',
        targetId: row.id,
        targetLabel: `public API · ${row.studentCode} ${row.firstName} ${row.lastName}`,
        detail: `GET /api/public/v1/students/${row.id}`,
        req,
      });
    }

    return ok({
      data: {
        ...core,
        fullName: `${row.prefix ?? ''}${row.firstName} ${row.lastName}`.trim(),
        // Flattened current placement, so a row from here is shaped like a row
        // from GET /students and a caller can reuse the same mapper. null when
        // the student has no enrollment in the active year — which is exactly
        // the case that makes this endpoint necessary.
        gradeLevel: current?.gradeLevel ?? null,
        classroom: current?.classroom ?? null,
        classNumber: current?.classNumber ?? null,
        photoUrl: row.hasPhoto ? `/api/public/v1/students/${row.id}/photo` : null,
        ...(withPii ? { citizenId: tryDecrypt(citizenIdEncrypted) } : {}),
        exit:
          exitType || exitDate || exitAcademicYearId
            ? {
                type: exitType,
                date: exitDate,
                yearId: exitAcademicYearId,
                year: exitYear?.year ?? null,
              }
            : null,
        enrollments: history,
        // Which year `gradeLevel`/`classroom`/`classNumber` above refer to.
        // Same shape as the list route's `academicYear`.
        academicYear: yearById.get(activeYearId) ?? null,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

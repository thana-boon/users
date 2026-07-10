import type { NextRequest } from 'next/server';
import { and, asc, eq, ilike, inArray, notExists, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments, academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * GET /api/users/students/unplaced?yearId=&q= — existing students who do NOT have
 * an enrollment in the given academic year (i.e. not on that year's roll). Feeds
 * the "จัดนักเรียนเข้าห้อง" pool for re-entries / mid-year transfers-in. Optional
 * `q` filters by name or code. Capped at 50 rows. Each row carries the student's
 * latest enrollment (grade/room + year) as context so you can tell where they
 * came from (e.g. last year's ป.6/2).
 */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const yearId = Number(sp.get('yearId'));
    if (!Number.isFinite(yearId)) return badRequest('ต้องระบุ yearId');
    const q = sp.get('q')?.trim();

    const rows = await db
      .select({
        id: students.id,
        studentCode: students.studentCode,
        prefix: students.prefix,
        firstName: students.firstName,
        lastName: students.lastName,
        gender: students.gender,
        status: students.status,
      })
      .from(students)
      .where(
        and(
          eq(students.isArchived, false),
          notExists(
            db
              .select({ one: sql`1` })
              .from(enrollments)
              .where(
                and(
                  eq(enrollments.studentId, students.id),
                  eq(enrollments.academicYearId, yearId),
                ),
              ),
          ),
          q
            ? or(
                ilike(students.firstName, `%${q}%`),
                ilike(students.lastName, `%${q}%`),
                ilike(students.studentCode, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(students.studentCode))
      .limit(50);

    // Attach each student's latest enrollment (grade/room + year) as context.
    const ids = rows.map((r) => r.id);
    const lastMap = new Map<number, { grade: string | null; room: string | null; year: number }>();
    if (ids.length) {
      const enr = await db
        .select({
          studentId: enrollments.studentId,
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          year: academicYears.year,
        })
        .from(enrollments)
        .innerJoin(academicYears, eq(academicYears.id, enrollments.academicYearId))
        .where(inArray(enrollments.studentId, ids));
      for (const e of enr) {
        const cur = lastMap.get(e.studentId);
        if (!cur || e.year > cur.year) lastMap.set(e.studentId, { grade: e.gradeLevel, room: e.classroom, year: e.year });
      }
    }

    const data = rows.map((r) => {
      const last = lastMap.get(r.id);
      return { ...r, lastGrade: last?.grade ?? null, lastRoom: last?.room ?? null, lastYear: last?.year ?? null };
    });

    return ok({ data });
  } catch (err) {
    return handleError(err);
  }
}

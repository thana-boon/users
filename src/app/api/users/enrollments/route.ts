import type { NextRequest } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { resolveActiveYearId } from '@/lib/services/students';

export const runtime = 'nodejs';

/**
 * GET /api/users/enrollments?yearId=&grade=&classroom=
 *
 * Full (unpaginated) roster for one academic year, optionally scoped to a grade
 * and/or room. Feeds the promotion tool (source-year roster) and the class-
 * number tool (one room). Includes lifecycle `status` so the UI can default-
 * exclude withdrawn/graduated students from promotion.
 */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    const grade = (sp.get('grade') ?? '').trim();
    const classroom = (sp.get('classroom') ?? '').trim();

    const conds = [
      eq(enrollments.academicYearId, yearId),
      eq(students.isArchived, false),
    ];
    if (grade) conds.push(eq(enrollments.gradeLevel, grade));
    if (classroom) conds.push(eq(enrollments.classroom, classroom));

    const rows = await db
      .select({
        enrollmentId: enrollments.id,
        studentId: students.id,
        studentCode: students.studentCode,
        prefix: students.prefix,
        firstName: students.firstName,
        lastName: students.lastName,
        gender: students.gender,
        status: students.status,
        gradeLevel: enrollments.gradeLevel,
        classroom: enrollments.classroom,
        classNumber: enrollments.classNumber,
        seqOrder: enrollments.seqOrder,
      })
      .from(students)
      .innerJoin(enrollments, eq(enrollments.studentId, students.id))
      .where(and(...conds))
      .orderBy(
        asc(enrollments.gradeLevel),
        asc(enrollments.classroom),
        asc(enrollments.seqOrder), // ASC = NULLS LAST in Postgres
        asc(students.studentCode),
      );

    return ok({ yearId, data: rows });
  } catch (err) {
    return handleError(err);
  }
}

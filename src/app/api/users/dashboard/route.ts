import type { NextRequest } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments, teachers, academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { resolveActiveYearId } from '@/lib/services/students';

export const runtime = 'nodejs';

const GRADE_ORDER = [
  'เตรียมอนุบาล', 'อ.1', 'อ.2', 'อ.3',
  'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6',
  'ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6',
];

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const yearId = await resolveActiveYearId();
    const activeYear = await db.query.academicYears.findFirst({
      where: eq(academicYears.id, yearId),
    });

    const base = and(
      eq(enrollments.academicYearId, yearId),
      eq(students.isArchived, false),
    );

    const [totalRes, byGrade, byGender, byReligion, newest, teacherBySubject, teacherTotal] =
      await Promise.all([
        db
          .select({ n: sql<number>`count(*)` })
          .from(students)
          .innerJoin(enrollments, eq(enrollments.studentId, students.id))
          .where(base),
        db
          .select({ grade: enrollments.gradeLevel, n: sql<number>`count(*)` })
          .from(students)
          .innerJoin(enrollments, eq(enrollments.studentId, students.id))
          .where(base)
          .groupBy(enrollments.gradeLevel),
        db
          .select({ gender: students.gender, n: sql<number>`count(*)` })
          .from(students)
          .innerJoin(enrollments, eq(enrollments.studentId, students.id))
          .where(base)
          .groupBy(students.gender),
        db
          .select({ religion: students.religion, n: sql<number>`count(*)` })
          .from(students)
          .innerJoin(enrollments, eq(enrollments.studentId, students.id))
          .where(base)
          .groupBy(students.religion),
        db
          .select({
            id: students.id,
            studentCode: students.studentCode,
            firstName: students.firstName,
            lastName: students.lastName,
            admissionDate: students.admissionDate,
            gradeLevel: enrollments.gradeLevel,
          })
          .from(students)
          .innerJoin(enrollments, eq(enrollments.studentId, students.id))
          .where(base)
          .orderBy(desc(students.createdAt))
          .limit(8),
        db
          .select({ subjectGroup: teachers.subjectGroup, n: sql<number>`count(*)` })
          .from(teachers)
          .where(eq(teachers.isArchived, false))
          .groupBy(teachers.subjectGroup),
        db
          .select({ n: sql<number>`count(*)` })
          .from(teachers)
          .where(eq(teachers.isArchived, false)),
      ]);

    const gradeMap = new Map(byGrade.map((r) => [r.grade ?? '-', Number(r.n)]));
    const byGradeSorted = GRADE_ORDER.filter((gr) => gradeMap.has(gr)).map((gr) => ({
      grade: gr,
      count: gradeMap.get(gr)!,
    }));
    // include any grades not in the canonical order
    for (const [gr, n] of gradeMap) {
      if (!GRADE_ORDER.includes(gr)) byGradeSorted.push({ grade: gr, count: n });
    }

    return ok({
      activeYear: activeYear
        ? { id: activeYear.id, year: activeYear.year, isActive: activeYear.isActive }
        : null,
      totalStudents: Number(totalRes[0]?.n ?? 0),
      totalTeachers: Number(teacherTotal[0]?.n ?? 0),
      byGrade: byGradeSorted,
      byGender: byGender.map((r) => ({ gender: r.gender ?? 'ไม่ระบุ', count: Number(r.n) })),
      byReligion: byReligion
        .map((r) => ({ religion: r.religion || 'ไม่ระบุ', count: Number(r.n) }))
        .sort((a, b) => b.count - a.count),
      newestStudents: newest,
      teachersBySubject: teacherBySubject
        .map((r) => ({ subjectGroup: r.subjectGroup || 'ไม่ระบุ', count: Number(r.n) }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    return handleError(err);
  }
}

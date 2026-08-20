import type { NextRequest } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { enrollments, teachers, specialTeachers, academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { resolveActiveYearId } from '@/lib/services/students';
import { compareGrades } from '@/lib/grades';

export const runtime = 'nodejs';

/** Distinct values that populate the filter dropdowns. */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();

    const [grades, rooms, subjects, specialSubjects, years] = await Promise.all([
      db
        .selectDistinct({ v: enrollments.gradeLevel })
        .from(enrollments)
        .where(and(eq(enrollments.academicYearId, yearId), isNotNull(enrollments.gradeLevel))),
      db
        .selectDistinct({ v: enrollments.classroom })
        .from(enrollments)
        .where(and(eq(enrollments.academicYearId, yearId), isNotNull(enrollments.classroom))),
      db
        .selectDistinct({ v: teachers.subjectGroup })
        .from(teachers)
        .where(and(eq(teachers.isArchived, false), isNotNull(teachers.subjectGroup))),
      // อาจารย์พิเศษ share the same free-text กลุ่มสาระ column, so a group that
      // so far has only guest teachers in it must still appear in the picker —
      // otherwise the next admin retypes it and the two spellings drift apart.
      db
        .selectDistinct({ v: specialTeachers.subjectGroup })
        .from(specialTeachers)
        .where(and(eq(specialTeachers.isArchived, false), isNotNull(specialTeachers.subjectGroup))),
      db.select().from(academicYears).orderBy(academicYears.year),
    ]);

    const gradeVals = grades.map((g) => g.v!).filter(Boolean);
    gradeVals.sort(compareGrades);

    return ok({
      yearId,
      grades: gradeVals,
      classrooms: rooms.map((r) => r.v!).filter(Boolean).sort(),
      subjectGroups: [
        ...new Set([...subjects, ...specialSubjects].map((s) => s.v!).filter(Boolean)),
      ].sort(),
      years: years.map((y) => ({ id: y.id, year: y.year, isActive: y.isActive })),
    });
  } catch (err) {
    return handleError(err);
  }
}

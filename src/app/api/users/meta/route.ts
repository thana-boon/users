import type { NextRequest } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { enrollments, teachers, academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { resolveActiveYearId } from '@/lib/services/students';

export const runtime = 'nodejs';

const GRADE_ORDER = [
  'เตรียมอนุบาล', 'อ.1', 'อ.2', 'อ.3',
  'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6',
  'ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6',
];

/** Distinct values that populate the filter dropdowns. */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();

    const [grades, rooms, subjects, years] = await Promise.all([
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
      db.select().from(academicYears).orderBy(academicYears.year),
    ]);

    const gradeVals = grades.map((g) => g.v!).filter(Boolean);
    gradeVals.sort((a, b) => {
      const ia = GRADE_ORDER.indexOf(a);
      const ib = GRADE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    return ok({
      yearId,
      grades: gradeVals,
      classrooms: rooms.map((r) => r.v!).filter(Boolean).sort(),
      subjectGroups: subjects.map((s) => s.v!).filter(Boolean).sort(),
      years: years.map((y) => ({ id: y.id, year: y.year, isActive: y.isActive })),
    });
  } catch (err) {
    return handleError(err);
  }
}

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

    const [totalRes, byGradeRoomGender, byGender, newest, teacherBySubject, teacherTotal] =
      await Promise.all([
        db
          .select({ n: sql<number>`count(*)` })
          .from(students)
          .innerJoin(enrollments, eq(enrollments.studentId, students.id))
          .where(base),
        // grade × room × gender counts — enough to build both the stacked
        // by-grade chart and its per-room drill-down in one round-trip.
        db
          .select({
            grade: enrollments.gradeLevel,
            classroom: enrollments.classroom,
            gender: students.gender,
            n: sql<number>`count(*)`,
          })
          .from(students)
          .innerJoin(enrollments, eq(enrollments.studentId, students.id))
          .where(base)
          .groupBy(enrollments.gradeLevel, enrollments.classroom, students.gender),
        db
          .select({ gender: students.gender, n: sql<number>`count(*)` })
          .from(students)
          .innerJoin(enrollments, eq(enrollments.studentId, students.id))
          .where(base)
          .groupBy(students.gender),
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

    // Classify a raw gender string into male / female / other buckets.
    const genderBucket = (g: string | null): 'male' | 'female' | 'other' => {
      const v = (g ?? '').trim();
      if (v.includes('ชาย')) return 'male'; // ชาย, เด็กชาย, นาย
      if (v.includes('หญิง')) return 'female'; // หญิง, เด็กหญิง
      return 'other';
    };

    type Bucket = { male: number; female: number; other: number; count: number };
    const emptyBucket = (): Bucket => ({ male: 0, female: 0, other: 0, count: 0 });
    const addTo = (b: Bucket, bucket: keyof Bucket, n: number) => {
      b[bucket] += n;
      b.count += n;
    };

    // grade -> { totals, rooms: room -> bucket }
    const gradeAgg = new Map<string, { totals: Bucket; rooms: Map<string, Bucket> }>();
    for (const r of byGradeRoomGender) {
      const grade = r.grade ?? 'ไม่ระบุ';
      const room = r.classroom ?? '-';
      const n = Number(r.n);
      const b = genderBucket(r.gender);
      let g = gradeAgg.get(grade);
      if (!g) {
        g = { totals: emptyBucket(), rooms: new Map() };
        gradeAgg.set(grade, g);
      }
      addTo(g.totals, b, n);
      let rb = g.rooms.get(room);
      if (!rb) {
        rb = emptyBucket();
        g.rooms.set(room, rb);
      }
      addTo(rb, b, n);
    }

    const gradeSortKey = (gr: string) => {
      const i = GRADE_ORDER.indexOf(gr);
      return i === -1 ? 99 : i;
    };
    const byGrade = [...gradeAgg.entries()]
      .sort((a, b) => gradeSortKey(a[0]) - gradeSortKey(b[0]))
      .map(([grade, g]) => ({
        grade,
        ...g.totals,
        rooms: [...g.rooms.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], 'th', { numeric: true }))
          .map(([classroom, rb]) => ({ classroom, ...rb })),
      }));

    return ok({
      activeYear: activeYear
        ? { id: activeYear.id, year: activeYear.year, isActive: activeYear.isActive }
        : null,
      totalStudents: Number(totalRes[0]?.n ?? 0),
      totalTeachers: Number(teacherTotal[0]?.n ?? 0),
      byGrade,
      byGender: byGender.map((r) => ({ gender: r.gender ?? 'ไม่ระบุ', count: Number(r.n) })),
      newestStudents: newest,
      teachersBySubject: teacherBySubject
        .map((r) => ({ subjectGroup: r.subjectGroup || 'ไม่ระบุ', count: Number(r.n) }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (err) {
    return handleError(err);
  }
}

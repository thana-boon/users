import type { NextRequest } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { academicYears, enrollments, homeroomTeachers, students, teachers } from '@/db/schema';
import { requireApiScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { resolveActiveYearId } from '@/lib/services/students';
import { compareGrades } from '@/lib/grades';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/homerooms — ครูประจำชั้น per room, for other systems.
 *
 * Auth: `teachers:read` — the payload is teacher identity, so it rides the
 * existing teacher-roster scope rather than a new one. Keys already granted
 * teachers:read gain this endpoint with no re-issue or re-scope.
 *
 * Query: ?yearId= (default: active year) ?grade= ?classroom=
 * Returns every room that has students in the year (assigned or not, so the
 * consumer can tell "no homeroom teacher yet" apart from "room doesn't exist"),
 * plus rooms that only exist as an assignment. No PII, no pagination — a school
 * has at most a few dozen rooms.
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'teachers:read');
  if (!guard.ok) return guard.response;

  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    const grade = (sp.get('grade') ?? '').trim();
    const classroom = (sp.get('classroom') ?? '').trim();

    const roomConds = [
      eq(enrollments.academicYearId, yearId),
      eq(students.isArchived, false),
      eq(students.status, 'studying' as const),
    ];
    const assignConds = [eq(homeroomTeachers.academicYearId, yearId)];
    if (grade) {
      roomConds.push(eq(enrollments.gradeLevel, grade));
      assignConds.push(eq(homeroomTeachers.gradeLevel, grade));
    }
    if (classroom) {
      roomConds.push(eq(enrollments.classroom, classroom));
      assignConds.push(eq(homeroomTeachers.classroom, classroom));
    }

    const [roomRows, assignRows, yearRow] = await Promise.all([
      db
        .select({
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          n: sql<number>`count(*)`,
        })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(and(...roomConds))
        .groupBy(enrollments.gradeLevel, enrollments.classroom),
      db
        .select({
          gradeLevel: homeroomTeachers.gradeLevel,
          classroom: homeroomTeachers.classroom,
          id: teachers.id,
          teacherCode: teachers.teacherCode,
          prefix: teachers.prefix,
          firstName: teachers.firstName,
          lastName: teachers.lastName,
          email: teachers.email,
          subjectGroup: teachers.subjectGroup,
          employmentStatus: teachers.employmentStatus,
        })
        .from(homeroomTeachers)
        .innerJoin(teachers, eq(teachers.id, homeroomTeachers.teacherId))
        .where(and(...assignConds))
        .orderBy(asc(homeroomTeachers.id)),
      db.query.academicYears.findFirst({ where: eq(academicYears.id, yearId) }),
    ]);

    type RoomOut = {
      gradeLevel: string;
      classroom: string;
      studentCount: number;
      homeroomTeachers: {
        id: number;
        teacherCode: string;
        prefix: string | null;
        firstName: string;
        lastName: string;
        fullName: string;
        email: string | null;
        subjectGroup: string | null;
        employmentStatus: string;
      }[];
    };

    const byKey = new Map<string, RoomOut>();
    for (const r of roomRows) {
      if (!r.gradeLevel || !r.classroom) continue;
      byKey.set(`${r.gradeLevel}|${r.classroom}`, {
        gradeLevel: r.gradeLevel,
        classroom: r.classroom,
        studentCount: Number(r.n),
        homeroomTeachers: [],
      });
    }
    for (const a of assignRows) {
      const key = `${a.gradeLevel}|${a.classroom}`;
      let room = byKey.get(key);
      if (!room) {
        room = { gradeLevel: a.gradeLevel, classroom: a.classroom, studentCount: 0, homeroomTeachers: [] };
        byKey.set(key, room);
      }
      room.homeroomTeachers.push({
        id: a.id,
        teacherCode: a.teacherCode,
        prefix: a.prefix,
        firstName: a.firstName,
        lastName: a.lastName,
        fullName: `${a.prefix ?? ''}${a.firstName} ${a.lastName}`.trim(),
        email: a.email,
        subjectGroup: a.subjectGroup,
        employmentStatus: a.employmentStatus,
      });
    }

    const data = [...byKey.values()].sort(
      (a, b) =>
        compareGrades(a.gradeLevel, b.gradeLevel) ||
        a.classroom.localeCompare(b.classroom, 'th', { numeric: true }),
    );

    return ok({
      data,
      academicYear: yearRow
        ? {
            id: yearRow.id,
            year: yearRow.year,
            startDate: yearRow.startDate,
            endDate: yearRow.endDate,
            term1Start: yearRow.term1Start,
            term1End: yearRow.term1End,
            term2Start: yearRow.term2Start,
            term2End: yearRow.term2End,
          }
        : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

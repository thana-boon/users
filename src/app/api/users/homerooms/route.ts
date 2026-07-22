import type { NextRequest } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears, enrollments, homeroomTeachers, students, teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { resolveActiveYearId } from '@/lib/services/students';
import { compareGrades } from '@/lib/grades';

export const runtime = 'nodejs';

/** Sort ห้อง strings numerically when possible ('2' before '10'). */
const byRoom = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });

export interface HomeroomRoom {
  gradeLevel: string;
  classroom: string;
  studentCount: number;
  teachers: {
    id: number;
    teacherCode: string;
    prefix: string | null;
    firstName: string;
    lastName: string;
    subjectGroup: string | null;
    employmentStatus: string;
  }[];
}

/**
 * GET /api/users/homerooms?yearId=
 *
 * A "room" is whatever (grade, classroom) exists in enrollments for the year —
 * plus any room that already has an assignment but lost its students (so a
 * stale assignment stays visible and can be cleared). Also returns the active
 * teacher list for the picker, saving the page a second round trip.
 */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();

    const [roomRows, assignRows, teacherRows] = await Promise.all([
      db
        .select({
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          n: sql<number>`count(*)`,
        })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(
          and(
            eq(enrollments.academicYearId, yearId),
            eq(students.isArchived, false),
            eq(students.status, 'studying'),
          ),
        )
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
          subjectGroup: teachers.subjectGroup,
          employmentStatus: teachers.employmentStatus,
        })
        .from(homeroomTeachers)
        .innerJoin(teachers, eq(teachers.id, homeroomTeachers.teacherId))
        .where(eq(homeroomTeachers.academicYearId, yearId))
        .orderBy(asc(homeroomTeachers.id)),
      db
        .select({
          id: teachers.id,
          teacherCode: teachers.teacherCode,
          prefix: teachers.prefix,
          firstName: teachers.firstName,
          lastName: teachers.lastName,
          subjectGroup: teachers.subjectGroup,
        })
        .from(teachers)
        .where(and(eq(teachers.isArchived, false), eq(teachers.employmentStatus, 'active')))
        .orderBy(asc(teachers.teacherCode)),
    ]);

    const byKey = new Map<string, HomeroomRoom>();
    for (const r of roomRows) {
      if (!r.gradeLevel || !r.classroom) continue;
      byKey.set(`${r.gradeLevel}|${r.classroom}`, {
        gradeLevel: r.gradeLevel,
        classroom: r.classroom,
        studentCount: Number(r.n),
        teachers: [],
      });
    }
    for (const a of assignRows) {
      const key = `${a.gradeLevel}|${a.classroom}`;
      let room = byKey.get(key);
      if (!room) {
        // Assignment survives with 0 students so it can still be reviewed/cleared.
        room = { gradeLevel: a.gradeLevel, classroom: a.classroom, studentCount: 0, teachers: [] };
        byKey.set(key, room);
      }
      room.teachers.push({
        id: a.id,
        teacherCode: a.teacherCode,
        prefix: a.prefix,
        firstName: a.firstName,
        lastName: a.lastName,
        subjectGroup: a.subjectGroup,
        employmentStatus: a.employmentStatus,
      });
    }

    const rooms = [...byKey.values()].sort(
      (a, b) => compareGrades(a.gradeLevel, b.gradeLevel) || byRoom(a.classroom, b.classroom),
    );

    return ok({ yearId, rooms, teachers: teacherRows });
  } catch (err) {
    return handleError(err);
  }
}

const saveSchema = z.object({
  academicYearId: z.number().int().positive(),
  gradeLevel: z.string().min(1).max(32),
  classroom: z.string().min(1).max(16),
  // Empty = clear the room's homeroom assignment. A room can have more than
  // one homeroom teacher (ครูคู่ชั้น) but never an absurd number.
  teacherIds: z.array(z.number().int().positive()).max(5),
});

/** POST — replace the homeroom teacher list of one room (year+grade+classroom). */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = saveSchema.parse(await req.json());
    const ids = [...new Set(body.teacherIds)];

    const year = await db.query.academicYears.findFirst({
      where: eq(academicYears.id, body.academicYearId),
    });
    if (!year) return badRequest('ไม่พบปีการศึกษานี้');

    const codes: string[] = [];
    for (const id of ids) {
      const t = await db.query.teachers.findFirst({ where: eq(teachers.id, id) });
      if (!t || t.isArchived) return badRequest(`ไม่พบครู id ${id}`);
      codes.push(t.teacherCode);
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(homeroomTeachers)
        .where(
          and(
            eq(homeroomTeachers.academicYearId, body.academicYearId),
            eq(homeroomTeachers.gradeLevel, body.gradeLevel),
            eq(homeroomTeachers.classroom, body.classroom),
          ),
        );
      if (ids.length > 0) {
        await tx.insert(homeroomTeachers).values(
          ids.map((teacherId) => ({
            academicYearId: body.academicYearId,
            gradeLevel: body.gradeLevel,
            classroom: body.classroom,
            teacherId,
          })),
        );
      }
    });

    await recordAudit({
      session: guard.session,
      action: 'assign_homeroom',
      targetType: 'homeroom',
      targetLabel: `${body.gradeLevel}/${body.classroom} · ปี ${year.year}`,
      detail: ids.length > 0 ? `ครู: ${codes.join(', ')}` : 'ล้างการกำหนด',
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

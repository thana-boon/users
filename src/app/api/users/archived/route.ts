import type { NextRequest } from 'next/server';
import { and, asc, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students, teachers, workers, enrollments, academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * "ถังขยะ" — records removed with the ย้ายไปถังขยะ button are soft-deleted
 * (is_archived = true), so they vanish from every list. This endpoint surfaces
 * them so an admin can review and restore.
 *
 * GET  /api/users/archived      - archived students + teachers (optional ?q=).
 * POST /api/users/archived      - restore one ({ type, id }): is_archived = false.
 */

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();

    const studentWhere = and(
      eq(students.isArchived, true),
      q
        ? or(
            ilike(students.firstName, `%${q}%`),
            ilike(students.lastName, `%${q}%`),
            ilike(students.studentCode, `%${q}%`),
            ilike(students.nickname, `%${q}%`),
          )
        : undefined,
    );
    const teacherWhere = and(
      eq(teachers.isArchived, true),
      q
        ? or(
            ilike(teachers.firstName, `%${q}%`),
            ilike(teachers.lastName, `%${q}%`),
            ilike(teachers.teacherCode, `%${q}%`),
            ilike(teachers.email, `%${q}%`),
          )
        : undefined,
    );

    const workerWhere = and(
      eq(workers.isArchived, true),
      q
        ? or(
            ilike(workers.firstName, `%${q}%`),
            ilike(workers.lastName, `%${q}%`),
            ilike(workers.workerCode, `%${q}%`),
            ilike(workers.position, `%${q}%`),
          )
        : undefined,
    );

    const [studentRows, teacherRows, workerRows] = await Promise.all([
      db
        .select({
          id: students.id,
          studentCode: students.studentCode,
          prefix: students.prefix,
          firstName: students.firstName,
          lastName: students.lastName,
          nickname: students.nickname,
          status: students.status,
        })
        .from(students)
        .where(studentWhere)
        .orderBy(asc(students.studentCode)),
      db
        .select({
          id: teachers.id,
          teacherCode: teachers.teacherCode,
          prefix: teachers.prefix,
          firstName: teachers.firstName,
          lastName: teachers.lastName,
          subjectGroup: teachers.subjectGroup,
          role: teachers.role,
        })
        .from(teachers)
        .where(teacherWhere)
        .orderBy(asc(teachers.teacherCode)),
      db
        .select({
          id: workers.id,
          workerCode: workers.workerCode,
          prefix: workers.prefix,
          firstName: workers.firstName,
          lastName: workers.lastName,
          position: workers.position,
        })
        .from(workers)
        .where(workerWhere)
        .orderBy(asc(workers.workerCode)),
    ]);

    // Attach each archived student's latest enrollment (ชั้น/ห้อง + ปี) as context.
    const ids = studentRows.map((r) => r.id);
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
        .where(inArray(enrollments.studentId, ids))
        .orderBy(desc(academicYears.year));
      for (const e of enr) {
        if (!lastMap.has(e.studentId))
          lastMap.set(e.studentId, { grade: e.gradeLevel, room: e.classroom, year: e.year });
      }
    }

    const studentsData = studentRows.map((r) => {
      const last = lastMap.get(r.id);
      return { ...r, lastGrade: last?.grade ?? null, lastRoom: last?.room ?? null, lastYear: last?.year ?? null };
    });

    return ok({ students: studentsData, teachers: teacherRows, workers: workerRows });
  } catch (err) {
    return handleError(err);
  }
}

const restoreSchema = z.object({
  type: z.enum(['student', 'teacher', 'worker']),
  id: z.number().int(),
});

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const { type, id } = restoreSchema.parse(await req.json());

    if (type === 'student') {
      const s = await db.query.students.findFirst({
        where: eq(students.id, id),
        columns: { id: true, studentCode: true, firstName: true, lastName: true, isArchived: true },
      });
      if (!s) return notFound();
      await db.update(students).set({ isArchived: false }).where(eq(students.id, id));
      await recordAudit({
        session: guard.session,
        action: 'restore',
        targetType: 'student',
        targetId: id,
        targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
        detail: 'กู้คืนจากถังขยะ',
        req,
      });
    } else if (type === 'teacher') {
      const t = await db.query.teachers.findFirst({
        where: eq(teachers.id, id),
        columns: { id: true, teacherCode: true, firstName: true, lastName: true, isArchived: true },
      });
      if (!t) return notFound();
      await db.update(teachers).set({ isArchived: false }).where(eq(teachers.id, id));
      await recordAudit({
        session: guard.session,
        action: 'restore',
        targetType: 'teacher',
        targetId: id,
        targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
        detail: 'กู้คืนจากถังขยะ',
        req,
      });
    } else {
      const w = await db.query.workers.findFirst({
        where: eq(workers.id, id),
        columns: { id: true, workerCode: true, firstName: true, lastName: true, isArchived: true },
      });
      if (!w) return notFound();
      await db.update(workers).set({ isArchived: false }).where(eq(workers.id, id));
      await recordAudit({
        session: guard.session,
        action: 'restore',
        targetType: 'worker',
        targetId: id,
        targetLabel: `${w.workerCode} ${w.firstName} ${w.lastName}`,
        detail: 'กู้คืนจากถังขยะ',
        req,
      });
    }

    return ok({ ok: true, restored: true });
  } catch (err) {
    return handleError(err);
  }
}

const deleteSchema = z.object({
  type: z.enum(['student', 'teacher', 'worker']),
  id: z.number().int(),
  confirmCode: z.string(),
});

/**
 * DELETE /api/users/archived — PERMANENT hard delete of a single record. Guard
 * rails: (1) the record must already be in the trash (is_archived = true), and
 * (2) the caller must echo back its exact code. Child rows (enrollments,
 * guardians, addresses, …) cascade via FK. The audit row is intentionally kept.
 *
 * ⚠ This orphans any downstream reference to the enrollment_id (e.g. ScoreBridge)
 * — intended only for records created by mistake and never used elsewhere.
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const { type, id, confirmCode } = deleteSchema.parse(await req.json());
    const typed = confirmCode.trim();

    if (type === 'student') {
      const s = await db.query.students.findFirst({
        where: eq(students.id, id),
        columns: { id: true, studentCode: true, firstName: true, lastName: true, isArchived: true },
      });
      if (!s) return notFound();
      if (!s.isArchived) return badRequest('ต้องย้ายรายการลงถังขยะก่อนจึงจะลบถาวรได้');
      if (typed !== s.studentCode) return badRequest('รหัสยืนยันไม่ตรงกับรหัสนักเรียน');

      await db.delete(students).where(eq(students.id, id)); // children cascade
      await recordAudit({
        session: guard.session,
        action: 'delete',
        targetType: 'student',
        targetId: id,
        targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
        detail: 'ลบถาวรจากถังขยะ (hard delete)',
        req,
      });
    } else if (type === 'teacher') {
      const t = await db.query.teachers.findFirst({
        where: eq(teachers.id, id),
        columns: { id: true, teacherCode: true, firstName: true, lastName: true, isArchived: true },
      });
      if (!t) return notFound();
      if (!t.isArchived) return badRequest('ต้องย้ายรายการลงถังขยะก่อนจึงจะลบถาวรได้');
      if (typed !== t.teacherCode) return badRequest('รหัสยืนยันไม่ตรงกับรหัสครู');

      await db.delete(teachers).where(eq(teachers.id, id));
      await recordAudit({
        session: guard.session,
        action: 'delete',
        targetType: 'teacher',
        targetId: id,
        targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
        detail: 'ลบถาวรจากถังขยะ (hard delete)',
        req,
      });
    } else {
      const w = await db.query.workers.findFirst({
        where: eq(workers.id, id),
        columns: { id: true, workerCode: true, firstName: true, lastName: true, isArchived: true },
      });
      if (!w) return notFound();
      if (!w.isArchived) return badRequest('ต้องย้ายรายการลงถังขยะก่อนจึงจะลบถาวรได้');
      if (typed !== w.workerCode) return badRequest('รหัสยืนยันไม่ตรงกับรหัสคนงาน');

      await db.delete(workers).where(eq(workers.id, id));
      await recordAudit({
        session: guard.session,
        action: 'delete',
        targetType: 'worker',
        targetId: id,
        targetLabel: `${w.workerCode} ${w.firstName} ${w.lastName}`,
        detail: 'ลบถาวรจากถังขยะ (hard delete)',
        req,
      });
    }

    return ok({ ok: true, deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

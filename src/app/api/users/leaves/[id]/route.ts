import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students, studentLeaves } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, conflict, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { endLeave, deleteLeave } from '@/lib/services/leaves';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const returnSchema = z.object({
  returnedDate: z.string().min(1),
  note: z.string().nullable().optional(),
});

/** The student behind a leave episode, for the audit label. */
async function leaveTarget(leaveId: number) {
  const [row] = await db
    .select({
      studentId: students.id,
      studentCode: students.studentCode,
      firstName: students.firstName,
      lastName: students.lastName,
      leaveType: studentLeaves.leaveType,
      returnedDate: studentLeaves.returnedDate,
    })
    .from(studentLeaves)
    .innerJoin(students, eq(students.id, studentLeaves.studentId))
    .where(eq(studentLeaves.id, leaveId));
  return row ?? null;
}

/**
 * PATCH /api/users/leaves/[id] — บันทึกกลับมาเรียน. Closes the episode by
 * stamping the return date; the student's status was never changed, so there is
 * nothing to reinstate.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = returnSchema.parse(await req.json());
    if (!body.returnedDate.trim()) return badRequest('กรุณาระบุวันที่กลับมาเรียน');

    const target = await leaveTarget(id);
    if (!target) return notFound();
    if (target.returnedDate) return conflict('รายการนี้บันทึกกลับมาเรียนไปแล้ว');

    if (!(await endLeave(id, body.returnedDate, body.note))) {
      return conflict('รายการนี้บันทึกกลับมาเรียนไปแล้ว');
    }

    await recordAudit({
      session: guard.session,
      action: 'leave_end',
      targetType: 'student',
      targetId: target.studentId,
      targetLabel: `${target.studentCode} ${target.firstName} ${target.lastName}`,
      detail: `กลับมาเรียนหลัง${target.leaveType} (${body.returnedDate})`,
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

/** DELETE /api/users/leaves/[id] — remove an episode recorded by mistake. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const target = await leaveTarget(id);
    if (!target) return notFound();

    await deleteLeave(id);
    await recordAudit({
      session: guard.session,
      action: 'delete',
      targetType: 'student',
      targetId: target.studentId,
      targetLabel: `${target.studentCode} ${target.firstName} ${target.lastName}`,
      detail: `ลบรายการ${target.leaveType}`,
      req,
    });
    return ok({ ok: true, deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

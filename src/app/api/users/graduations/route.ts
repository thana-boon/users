import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { bulkSetStudentStatus, bulkReinstateStudents, listExitHistory } from '@/lib/services/students';

export const runtime = 'nodejs';

const schema = z.object({
  academicYearId: z.number().int(),
  studentIds: z.array(z.number().int()).min(1, 'ต้องเลือกนักเรียนอย่างน้อย 1 คน'),
  exitType: z.string().nullable().optional(),
  exitReason: z.string().nullable().optional(),
  exitDate: z.string().nullable().optional(),
  recordCompletion: z.boolean().default(true),
});

/** GET /api/users/graduations — history of graduated students (newest year first). */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const data = await listExitHistory('graduated');
    return ok({ data });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/users/graduations — graduate a batch of students (e.g. a whole ม.6
 * cohort). Stores exit metadata + exit year and optionally records a จบช่วงชั้น
 * milestone for each student's grade that year.
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = schema.parse(await req.json());
    if (!body.exitDate || !body.exitDate.trim()) return badRequest('กรุณาระบุวันที่จบการศึกษา');
    if (!body.exitReason || !body.exitReason.trim()) return badRequest('กรุณาระบุเหตุผล');

    const year = await db.query.academicYears.findFirst({
      where: eq(academicYears.id, body.academicYearId),
    });
    if (!year) return badRequest('ไม่พบปีการศึกษา');

    const result = await bulkSetStudentStatus({
      studentIds: body.studentIds,
      status: 'graduated',
      exitType: body.exitType ?? 'จบการศึกษา',
      exitReason: body.exitReason,
      exitDate: body.exitDate,
      academicYearId: body.academicYearId,
      recordCompletion: body.recordCompletion,
    });

    await recordAudit({
      session: guard.session,
      action: 'graduate',
      targetType: 'student',
      targetLabel: `จบการศึกษา ปี ${year.year}`,
      detail: `จบการศึกษา ${result.updated} คน${result.completionsRecorded ? ` (บันทึกจบช่วงชั้น ${result.completionsRecorded} คน)` : ''} — ${body.exitDate}`,
      req,
    });

    return ok({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}

const revertSchema = z.object({
  studentIds: z.array(z.number().int()).min(1, 'ต้องเลือกนักเรียนอย่างน้อย 1 คน'),
});

/**
 * DELETE /api/users/graduations — revert a graduation batch: reinstate the given
 * students to กำลังศึกษา and clear their exit metadata (undo a whole ชุด at once).
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = revertSchema.parse(await req.json());
    const updated = await bulkReinstateStudents(body.studentIds);

    await recordAudit({
      session: guard.session,
      action: 'reinstate',
      targetType: 'student',
      targetLabel: 'ย้อนกลับการจบการศึกษา',
      detail: `คืนสถานะกำลังศึกษา ${updated} คน (ย้อนจบการศึกษาทั้งชุด)`,
      req,
    });

    return ok({ ok: true, updated });
  } catch (err) {
    return handleError(err);
  }
}

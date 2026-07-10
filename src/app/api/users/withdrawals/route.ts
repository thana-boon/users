import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { bulkSetStudentStatus, listExitHistory } from '@/lib/services/students';

export const runtime = 'nodejs';

const schema = z.object({
  academicYearId: z.number().int(),
  studentIds: z.array(z.number().int()).min(1, 'ต้องเลือกนักเรียนอย่างน้อย 1 คน'),
  exitType: z.string().nullable().optional(),
  exitReason: z.string().nullable().optional(),
  exitDate: z.string().nullable().optional(),
});

/** GET /api/users/withdrawals — history of withdrawn/จำหน่าย students (newest first). */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const data = await listExitHistory('withdrawn');
    return ok({ data });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/users/withdrawals — จำหน่าย/ลาออก a batch of students. Stores the exit
 * type/date/reason + exit year (fed to the future document-export API).
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = schema.parse(await req.json());
    if (!body.exitDate || !body.exitDate.trim()) return badRequest('กรุณาระบุวันที่ออก');
    if (!body.exitReason || !body.exitReason.trim()) return badRequest('กรุณาระบุเหตุผล');

    const year = await db.query.academicYears.findFirst({
      where: eq(academicYears.id, body.academicYearId),
    });
    if (!year) return badRequest('ไม่พบปีการศึกษา');

    const result = await bulkSetStudentStatus({
      studentIds: body.studentIds,
      status: 'withdrawn',
      exitType: body.exitType ?? 'ลาออก',
      exitReason: body.exitReason,
      exitDate: body.exitDate,
      academicYearId: body.academicYearId,
    });

    await recordAudit({
      session: guard.session,
      action: 'withdraw',
      targetType: 'student',
      targetLabel: `${body.exitType ?? 'ลาออก'} ปี ${year.year}`,
      detail: `จำหน่าย/ลาออก ${result.updated} คน — ${body.exitReason} (${body.exitDate})`,
      req,
    });

    return ok({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}

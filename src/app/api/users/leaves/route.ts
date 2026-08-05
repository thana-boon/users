import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { listLeaves, startLeave } from '@/lib/services/leaves';

export const runtime = 'nodejs';

const schema = z.object({
  academicYearId: z.number().int(),
  studentIds: z.array(z.number().int()).min(1, 'ต้องเลือกนักเรียนอย่างน้อย 1 คน'),
  leaveType: z.string().min(1).default('พักการเรียน'),
  startDate: z.string().min(1),
  expectedReturnDate: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  orderNo: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * GET /api/users/leaves?scope=open|all — พักการเรียน episodes.
 * `open` (default) = students away right now; `all` includes returned ones.
 */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'open';
    const data = await listLeaves(scope);
    return ok({ data });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/users/leaves — record พักการเรียน for a batch of students. Does NOT
 * change `students.status`: a suspended student stays on the roll and is
 * promoted normally (see schema.ts). Students already on leave are skipped.
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = schema.parse(await req.json());
    if (!body.startDate.trim()) return badRequest('กรุณาระบุวันที่เริ่มพัก');

    const year = await db.query.academicYears.findFirst({
      where: eq(academicYears.id, body.academicYearId),
    });
    if (!year) return badRequest('ไม่พบปีการศึกษา');

    const result = await startLeave(body);
    if (result.created === 0) {
      return badRequest('นักเรียนที่เลือกกำลังพักการเรียนอยู่แล้วทั้งหมด');
    }

    await recordAudit({
      session: guard.session,
      action: 'leave_start',
      targetType: 'student',
      targetLabel: `${body.leaveType} ปี ${year.year}`,
      detail:
        `${body.leaveType} ${result.created} คน — ${body.reason ?? '-'} (ตั้งแต่ ${body.startDate})` +
        (result.skipped.length ? ` · ข้าม ${result.skipped.length} คนที่พักอยู่แล้ว` : ''),
      req,
    });

    return ok({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}

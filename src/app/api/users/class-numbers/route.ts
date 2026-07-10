import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { saveClassNumbers, enrollmentIdsInYear } from '@/lib/services/promotion';

export const runtime = 'nodejs';

const schema = z.object({
  yearId: z.number().int(),
  grade: z.string().nullable().optional(),
  classroom: z.string().nullable().optional(),
  assignments: z
    .array(
      z.object({
        enrollmentId: z.number().int(),
        classNumber: z.string().nullable(),
        seqOrder: z.number().int().nullable(),
      }),
    )
    .min(1, 'ไม่มีข้อมูลเลขที่'),
});

/**
 * POST /api/users/class-numbers — persist explicit เลขที่ for a room. The UI
 * computes the values (sort by gender/code/name, keep-gaps vs sequential, or
 * manual edits); the server validates the ids belong to the year and writes.
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = schema.parse(await req.json());

    // Defence: only touch enrollments that actually belong to the given year.
    const valid = await enrollmentIdsInYear(
      body.assignments.map((a) => a.enrollmentId),
      body.yearId,
    );
    const assignments = body.assignments.filter((a) => valid.has(a.enrollmentId));
    if (!assignments.length) return badRequest('ไม่พบรายการเลขที่ที่ถูกต้องในปีการศึกษานี้');

    const n = await saveClassNumbers(assignments);
    await recordAudit({
      session: guard.session,
      action: 'renumber',
      targetType: 'enrollment',
      targetLabel: `${body.grade ?? ''} ${body.classroom ? `ห้อง ${body.classroom}` : ''}`.trim() || null,
      detail: `จัดเลขที่ ${n} คน`,
      req,
    });

    return ok({ ok: true, updated: n });
  } catch (err) {
    return handleError(err);
  }
}

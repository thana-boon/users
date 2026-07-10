import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { setStudentStatus } from '@/lib/services/students';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  status: z.enum(['studying', 'withdrawn', 'graduated']),
  exitType: z.string().nullable().optional(),
  exitReason: z.string().nullable().optional(),
  exitDate: z.string().nullable().optional(),
  academicYearId: z.number().int().nullable().optional(),
  completion: z
    .object({
      keyStage: z.enum(['kindergarten', 'primary', 'lower_secondary', 'upper_secondary']),
      gradeLevel: z.string().nullable().optional(),
      academicYearId: z.number().int().nullable().optional(),
      completionDate: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  placement: z
    .object({
      academicYearId: z.number().int(),
      gradeLevel: z.string().nullable().optional(),
      classroom: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

/**
 * POST /api/users/students/[id]/status — set lifecycle status.
 *   withdrawn/graduated : requires exitDate + exitReason (for the document API).
 *   studying            : reinstate (clears exit fields).
 * Optionally records a จบช่วงชั้น milestone (e.g. graduating the final stage).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = schema.parse(await req.json());

    if (body.status !== 'studying') {
      if (!body.exitDate || !body.exitDate.trim()) return badRequest('กรุณาระบุวันที่ออก');
      if (!body.exitReason || !body.exitReason.trim()) return badRequest('กรุณาระบุเหตุผล');
    }

    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!s) return notFound();

    await setStudentStatus(id, body);

    const action =
      body.status === 'withdrawn' ? 'withdraw' : body.status === 'graduated' ? 'graduate' : 'reinstate';
    await recordAudit({
      session: guard.session,
      action,
      targetType: 'student',
      targetId: id,
      targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
      detail:
        body.status === 'studying'
          ? `คืนสถานะกำลังศึกษา${body.placement ? ` → ${body.placement.gradeLevel ?? '-'}/${body.placement.classroom ?? '-'}` : ''}`
          : `${body.exitType ?? body.status} — ${body.exitReason ?? ''} (${body.exitDate ?? ''})`,
      req,
    });

    return ok({ ok: true, status: body.status });
  } catch (err) {
    return handleError(err);
  }
}

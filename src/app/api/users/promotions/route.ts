import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { promoteStudents } from '@/lib/services/promotion';

export const runtime = 'nodejs';

const schema = z.object({
  sourceYearId: z.number().int(),
  targetYearId: z.number().int(),
  recordCompletion: z.boolean().default(true),
  renumber: z.boolean().default(true),
  items: z
    .array(
      z.object({
        studentId: z.number().int(),
        fromGrade: z.string().nullable().optional(),
        targetGrade: z.string().nullable().optional(),
        targetClassroom: z.string().nullable().optional(),
      }),
    )
    .min(1, 'ต้องเลือกนักเรียนอย่างน้อย 1 คน'),
});

/**
 * POST /api/users/promotions — move a batch of students into their next-year
 * enrollment. Idempotent per (student, target year). Optionally records a
 * key-stage completion milestone and renumbers the target rooms.
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = schema.parse(await req.json());
    if (body.sourceYearId === body.targetYearId) {
      return badRequest('ปีต้นทางและปลายทางต้องต่างกัน');
    }

    const [src, tgt] = await Promise.all([
      db.query.academicYears.findFirst({ where: eq(academicYears.id, body.sourceYearId) }),
      db.query.academicYears.findFirst({ where: eq(academicYears.id, body.targetYearId) }),
    ]);
    if (!src) return badRequest('ไม่พบปีการศึกษาต้นทาง');
    if (!tgt) return badRequest('ไม่พบปีการศึกษาปลายทาง');

    const result = await promoteStudents({
      sourceYearId: body.sourceYearId,
      targetYearId: body.targetYearId,
      recordCompletion: body.recordCompletion,
      renumber: body.renumber,
      items: body.items.map((i) => ({
        studentId: i.studentId,
        fromGrade: i.fromGrade ?? null,
        targetGrade: i.targetGrade ?? null,
        targetClassroom: i.targetClassroom ?? null,
      })),
    });

    await recordAudit({
      session: guard.session,
      action: 'promote',
      targetType: 'promotion',
      targetLabel: `${src.year} → ${tgt.year}`,
      detail: `เลื่อนชั้น ${result.promoted} คน, บันทึกจบช่วงชั้น ${result.completionsRecorded} คน`,
      req,
    });

    return ok({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}

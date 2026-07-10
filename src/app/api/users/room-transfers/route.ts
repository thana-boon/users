import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { transferRooms } from '@/lib/services/promotion';

export const runtime = 'nodejs';

const schema = z.object({
  yearId: z.number().int(),
  grade: z.string().nullable().optional(),
  renumber: z.boolean().default(false),
  items: z
    .array(
      z.object({
        enrollmentId: z.number().int(),
        targetClassroom: z.string().nullable().optional(),
      }),
    )
    .min(1, 'ต้องเลือกนักเรียนอย่างน้อย 1 คน'),
});

/**
 * POST /api/users/room-transfers — move students between rooms within the SAME
 * academic year (the single-student "ย้ายห้อง" case). Updates each enrollment's
 * room in place; grade + year are unchanged. Optionally renumbers the grade.
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = schema.parse(await req.json());

    const year = await db.query.academicYears.findFirst({
      where: eq(academicYears.id, body.yearId),
    });
    if (!year) return badRequest('ไม่พบปีการศึกษา');

    const result = await transferRooms({
      yearId: body.yearId,
      grade: body.grade ?? null,
      renumber: body.renumber,
      items: body.items.map((i) => ({
        enrollmentId: i.enrollmentId,
        targetClassroom: i.targetClassroom ?? null,
      })),
    });

    await recordAudit({
      session: guard.session,
      action: 'transfer_room',
      targetType: 'enrollment',
      targetLabel: `${year.year}${body.grade ? ` • ${body.grade}` : ''}`,
      detail: `ย้ายห้อง ${result.moved} คน (ปีเดียวกัน)`,
      req,
    });

    return ok({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}

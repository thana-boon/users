import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/users/academic-years/[id]
 * Set active (exclusive), update dates, or soft-archive. NO hard delete —
 * archiving preserves enrollment_id references used by downstream systems.
 */
const schema = z.object({
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  term1Start: z.string().nullable().optional(),
  term1End: z.string().nullable().optional(),
  term2Start: z.string().nullable().optional(),
  term2End: z.string().nullable().optional(),
  setActive: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = schema.parse(await req.json());
    const y = await db.query.academicYears.findFirst({ where: eq(academicYears.id, id) });
    if (!y) return notFound();

    if (body.setActive === true) {
      await db.update(academicYears).set({ isActive: false });
    }
    const set: Record<string, unknown> = {};
    if (body.startDate !== undefined) set.startDate = body.startDate;
    if (body.endDate !== undefined) set.endDate = body.endDate;
    if (body.term1Start !== undefined) set.term1Start = body.term1Start;
    if (body.term1End !== undefined) set.term1End = body.term1End;
    if (body.term2Start !== undefined) set.term2Start = body.term2Start;
    if (body.term2End !== undefined) set.term2End = body.term2End;
    if (body.setActive !== undefined) set.isActive = body.setActive;
    if (body.isArchived !== undefined) set.isArchived = body.isArchived;

    await db.update(academicYears).set(set).where(eq(academicYears.id, id));
    await recordAudit({
      session: guard.session,
      action: body.isArchived ? 'archive' : 'update',
      targetType: 'academic_year',
      targetId: id,
      targetLabel: String(y.year),
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

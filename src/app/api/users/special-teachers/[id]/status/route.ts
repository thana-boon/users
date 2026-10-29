import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireAccess } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { resolveExitTerm } from '@/lib/services/terms';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  status: z.enum(['active', 'resigned']),
  exitDate: z.string().nullable().optional(),
  exitReason: z.string().nullable().optional(),
  academicYearId: z.number().int().nullable().optional(),
  term: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
});

/** POST /api/users/special-teachers/[id]/status — ยังสอนอยู่ / ลาออก (see teacher status route). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = schema.parse(await req.json());

    if (body.status === 'resigned') {
      if (!body.exitDate || !body.exitDate.trim()) return badRequest('กรุณาระบุวันที่ออก');
      if (body.academicYearId == null) return badRequest('กรุณาระบุปีการศึกษาที่ออก');
    }

    const row = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.id, id),
      columns: { id: true, specialTeacherCode: true, firstName: true, lastName: true },
    });
    if (!row) return notFound();

    const set =
      body.status === 'resigned'
        ? {
            employmentStatus: 'resigned' as const,
            exitDate: body.exitDate ?? null,
            exitReason: body.exitReason ?? null,
            exitAcademicYearId: body.academicYearId ?? null,
            exitTerm: await resolveExitTerm(body.academicYearId, body.term),
          }
        : {
            employmentStatus: 'active' as const,
            exitDate: null,
            exitReason: null,
            exitAcademicYearId: null,
            exitTerm: null,
          };
    await db.update(specialTeachers).set(set).where(eq(specialTeachers.id, id));

    await recordAudit({
      session: guard.session,
      action: body.status === 'resigned' ? 'resign' : 'reinstate',
      targetType: 'special_teacher',
      targetId: id,
      targetLabel: `${row.specialTeacherCode} ${row.firstName} ${row.lastName}`,
      detail:
        body.status === 'resigned'
          ? `ลาออก — ${body.exitReason ?? ''} (${body.exitDate ?? ''})`
          : 'คืนสถานะยังสอนอยู่',
      req,
    });

    return ok({ ok: true, status: body.status });
  } catch (err) {
    return handleError(err);
  }
}

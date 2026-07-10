import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  status: z.enum(['active', 'resigned']),
  exitDate: z.string().nullable().optional(),
  exitReason: z.string().nullable().optional(),
  academicYearId: z.number().int().nullable().optional(),
});

/**
 * POST /api/users/teachers/[id]/status — set employment status.
 *   resigned : requires exitDate + academicYearId (ปีการศึกษาที่ออก).
 *   active   : คืนสถานะทำงาน (clears exit fields).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = schema.parse(await req.json());

    if (body.status === 'resigned') {
      if (!body.exitDate || !body.exitDate.trim()) return badRequest('กรุณาระบุวันที่ออก');
      if (body.academicYearId == null) return badRequest('กรุณาระบุปีการศึกษาที่ออก');
    }

    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true },
    });
    if (!t) return notFound();

    const set =
      body.status === 'resigned'
        ? {
            employmentStatus: 'resigned' as const,
            exitDate: body.exitDate ?? null,
            exitReason: body.exitReason ?? null,
            exitAcademicYearId: body.academicYearId ?? null,
          }
        : {
            employmentStatus: 'active' as const,
            exitDate: null,
            exitReason: null,
            exitAcademicYearId: null,
          };
    await db.update(teachers).set(set).where(eq(teachers.id, id));

    await recordAudit({
      session: guard.session,
      action: body.status === 'resigned' ? 'resign' : 'reinstate',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail:
        body.status === 'resigned'
          ? `ลาออก — ${body.exitReason ?? ''} (${body.exitDate ?? ''})`
          : 'คืนสถานะทำงาน',
      req,
    });

    return ok({ ok: true, status: body.status });
  } catch (err) {
    return handleError(err);
  }
}

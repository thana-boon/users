import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { workers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { decrypt } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ field: z.enum(['citizen_id']) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const { field } = schema.parse(await req.json());
    const w = await db.query.workers.findFirst({ where: eq(workers.id, id) });
    if (!w) return notFound();

    const value = decrypt(w.citizenIdEncrypted);
    if (value === null) return badRequest('คนงานคนนี้ไม่มีเลขบัตรประชาชนในระบบ');

    await recordAudit({
      session: guard.session,
      action: 'reveal_citizen_id',
      targetType: 'worker',
      targetId: id,
      targetLabel: `${w.workerCode} ${w.firstName} ${w.lastName}`,
      req,
    });
    return ok({ field, value });
  } catch (err) {
    return handleError(err);
  }
}

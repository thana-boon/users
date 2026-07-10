import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { workers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { encrypt, maskCitizenId, tryDecrypt } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const w = await db.query.workers.findFirst({ where: eq(workers.id, id) });
    if (!w) return notFound();
    const { citizenIdEncrypted, photoBase64, ...core } = w;
    return ok({
      ...core,
      citizenIdMasked: maskCitizenId(tryDecrypt(citizenIdEncrypted)),
      hasCitizenId: !!citizenIdEncrypted,
      hasPhoto: !!photoBase64,
    });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  position: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  citizenId: z.string().optional(), // blank = keep
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = patchSchema.parse(await req.json());
    const w = await db.query.workers.findFirst({
      where: eq(workers.id, id),
      columns: { id: true, workerCode: true, firstName: true, lastName: true },
    });
    if (!w) return notFound();

    const { citizenId, ...rest } = body;
    const set: Record<string, unknown> = { ...rest };
    if (citizenId && citizenId.trim()) set.citizenIdEncrypted = encrypt(citizenId.trim());

    await db.update(workers).set(set).where(eq(workers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'worker',
      targetId: id,
      targetLabel: `${w.workerCode} ${w.firstName} ${w.lastName}`,
      detail: `แก้ไข: ${Object.keys(body).join(', ')}`,
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const w = await db.query.workers.findFirst({
      where: eq(workers.id, id),
      columns: { id: true, workerCode: true, firstName: true, lastName: true },
    });
    if (!w) return notFound();
    await db.update(workers).set({ isArchived: true }).where(eq(workers.id, id));
    await recordAudit({
      session: guard.session,
      action: 'archive',
      targetType: 'worker',
      targetId: id,
      targetLabel: `${w.workerCode} ${w.firstName} ${w.lastName}`,
      req,
    });
    return ok({ ok: true, archived: true });
  } catch (err) {
    return handleError(err);
  }
}

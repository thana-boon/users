import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { workers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { photoResponse } from '@/lib/services/photos';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** GET/POST/DELETE /api/users/workers/[id]/photo — inline base64 photo (see student route). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const w = await db.query.workers.findFirst({
      where: eq(workers.id, id),
      columns: { photoBase64: true, photoMime: true },
    });
    // ETag + 304, same as the students twin — see the note there.
    return photoResponse(req, w) ?? notFound('ยังไม่มีรูปภาพ');
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const w = await db.query.workers.findFirst({
      where: eq(workers.id, id),
      columns: { id: true, workerCode: true, firstName: true, lastName: true },
    });
    if (!w) return notFound();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badRequest('กรุณาแนบไฟล์รูปภาพ');
    if (!ALLOWED.has(file.type)) return badRequest('รองรับเฉพาะไฟล์ JPG, PNG, WEBP, GIF');
    if (file.size > MAX_BYTES) return badRequest('ไฟล์ใหญ่เกิน 5MB');

    const buf = Buffer.from(await file.arrayBuffer());
    await db
      .update(workers)
      .set({ photoBase64: buf.toString('base64'), photoMime: file.type })
      .where(eq(workers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'worker',
      targetId: id,
      targetLabel: `${w.workerCode} ${w.firstName} ${w.lastName}`,
      detail: 'อัปโหลดรูปคนงาน',
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

    await db
      .update(workers)
      .set({ photoBase64: null, photoMime: null })
      .where(eq(workers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'worker',
      targetId: id,
      targetLabel: `${w.workerCode} ${w.firstName} ${w.lastName}`,
      detail: 'ลบรูปคนงาน',
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

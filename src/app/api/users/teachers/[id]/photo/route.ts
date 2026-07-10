import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * GET/POST/DELETE /api/users/teachers/[id]/photo — profile image stored inline
 * as base64 in teachers.photo_base64 (mirrors the student photo route).
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { photoBase64: true, photoMime: true },
    });
    if (!t?.photoBase64) return notFound('ยังไม่มีรูปภาพ');
    const buf = Buffer.from(t.photoBase64, 'base64');
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': t.photoMime || 'image/jpeg',
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true },
    });
    if (!t) return notFound();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badRequest('กรุณาแนบไฟล์รูปภาพ');
    if (!ALLOWED.has(file.type)) return badRequest('รองรับเฉพาะไฟล์ JPG, PNG, WEBP, GIF');
    if (file.size > MAX_BYTES) return badRequest('ไฟล์ใหญ่เกิน 5MB');

    const buf = Buffer.from(await file.arrayBuffer());
    await db
      .update(teachers)
      .set({ photoBase64: buf.toString('base64'), photoMime: file.type })
      .where(eq(teachers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail: 'อัปโหลดรูปครู',
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
    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true },
    });
    if (!t) return notFound();

    await db
      .update(teachers)
      .set({ photoBase64: null, photoMime: null })
      .where(eq(teachers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail: 'ลบรูปครู',
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

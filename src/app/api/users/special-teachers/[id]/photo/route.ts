import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { photoResponse } from '@/lib/services/photos';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * GET/POST/DELETE /api/users/special-teachers/[id]/photo — profile image stored
 * inline as base64 in special_teachers.photo_base64, exactly like the ครู twin.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const row = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.id, id),
      columns: { photoBase64: true, photoMime: true },
    });
    return photoResponse(req, row) ?? notFound('ยังไม่มีรูปภาพ');
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const row = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.id, id),
      columns: { id: true, specialTeacherCode: true, firstName: true, lastName: true },
    });
    if (!row) return notFound();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badRequest('กรุณาแนบไฟล์รูปภาพ');
    if (!ALLOWED.has(file.type)) return badRequest('รองรับเฉพาะไฟล์ JPG, PNG, WEBP, GIF');
    if (file.size > MAX_BYTES) return badRequest('ไฟล์ใหญ่เกิน 5MB');

    const buf = Buffer.from(await file.arrayBuffer());
    await db
      .update(specialTeachers)
      .set({ photoBase64: buf.toString('base64'), photoMime: file.type })
      .where(eq(specialTeachers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'special_teacher',
      targetId: id,
      targetLabel: `${row.specialTeacherCode} ${row.firstName} ${row.lastName}`,
      detail: 'อัปโหลดรูปอาจารย์พิเศษ',
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
    const row = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.id, id),
      columns: { id: true, specialTeacherCode: true, firstName: true, lastName: true },
    });
    if (!row) return notFound();

    await db
      .update(specialTeachers)
      .set({ photoBase64: null, photoMime: null })
      .where(eq(specialTeachers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'special_teacher',
      targetId: id,
      targetLabel: `${row.specialTeacherCode} ${row.firstName} ${row.lastName}`,
      detail: 'ลบรูปอาจารย์พิเศษ',
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

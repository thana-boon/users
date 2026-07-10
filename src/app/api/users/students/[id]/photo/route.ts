import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * GET    /api/users/students/[id]/photo  - serve the stored profile image bytes.
 * POST   /api/users/students/[id]/photo  - upload (multipart: file=<image>).
 * DELETE /api/users/students/[id]/photo  - remove the photo.
 * Stored inline as base64 in students.photo_base64 (see schema note).
 */

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: { photoBase64: true, photoMime: true },
    });
    if (!s?.photoBase64) return notFound('ยังไม่มีรูปภาพ');
    const buf = Buffer.from(s.photoBase64, 'base64');
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': s.photoMime || 'image/jpeg',
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
    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!s) return notFound();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badRequest('กรุณาแนบไฟล์รูปภาพ');
    if (!ALLOWED.has(file.type)) return badRequest('รองรับเฉพาะไฟล์ JPG, PNG, WEBP, GIF');
    if (file.size > MAX_BYTES) return badRequest('ไฟล์ใหญ่เกิน 5MB');

    const buf = Buffer.from(await file.arrayBuffer());
    await db
      .update(students)
      .set({ photoBase64: buf.toString('base64'), photoMime: file.type })
      .where(eq(students.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'student',
      targetId: id,
      targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
      detail: 'อัปโหลดรูปนักเรียน',
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
    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!s) return notFound();

    await db
      .update(students)
      .set({ photoBase64: null, photoMime: null })
      .where(eq(students.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'student',
      targetId: id,
      targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
      detail: 'ลบรูปนักเรียน',
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

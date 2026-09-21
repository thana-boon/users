import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { students, teachers } from '@/db/schema';
import { requireSelf, requireSelfTeacher } from '@/lib/rbac';
import { ok, badRequest, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { photoResponse } from '@/lib/services/photos';
import { selfEditClosedMessage, selfEditEnabled } from '@/lib/services/settings';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * GET/POST/DELETE /api/users/me/photo — the signed-in person's own รูปติดบัตร.
 * Read by either audience, written only by a teacher (see below).
 *
 * The same route as teachers/[id]/photo with the id taken from the token
 * instead of the URL. Kept in the self-service list (rather than locked to
 * admins with the rest of the identity block) because a photo is the one piece
 * of the record the office has no way to keep current: the teacher is the only
 * person holding a recent one, and a wrong photo costs nothing but a wrong
 * photo. The browser still crops it to the face before upload (PhotoCard).
 *
 * Teachers only, deliberately: a student's photo is an official school
 * photograph, taken by the school and replaced by the school — see
 * services/student-self.ts. A student session gets a 403 here.
 *
 * Writes obey the same school-wide switch as the rest of self-service; the read
 * does not, because the header shows the photo whether or not editing is open.
 */

/**
 * GET is open to BOTH audiences — it is the person's own face, and the header
 * on /users/me shows it whichever kind of account is signed in. Only the writes
 * below are teacher-only.
 */
export async function GET(req: NextRequest) {
  const guard = await requireSelf(req);
  if (!guard.ok) return guard.response;
  try {
    const { audience, person } = guard;
    const row =
      audience === 'teacher'
        ? await db.query.teachers.findFirst({
            where: eq(teachers.id, person.id),
            columns: { photoBase64: true, photoMime: true },
          })
        : await db.query.students.findFirst({
            where: eq(students.id, person.id),
            columns: { photoBase64: true, photoMime: true },
          });
    return photoResponse(req, row) ?? notFound('ยังไม่มีรูปภาพ');
  } catch (err) {
    return handleError(err);
  }
}

/** The write gate both POST and DELETE pass: window open, still employed. */
async function canWrite(active: boolean): Promise<string | null> {
  if (!active) return 'บัญชีนี้ไม่ได้อยู่ในสถานะปัจจุบันแล้ว จึงแก้ไขข้อมูลไม่ได้';
  if (!(await selfEditEnabled('teacher'))) return selfEditClosedMessage('teacher');
  return null;
}

export async function POST(req: NextRequest) {
  const guard = await requireSelfTeacher(req);
  if (!guard.ok) return guard.response;
  try {
    const { id, code, firstName, lastName, active } = guard.teacher;
    const closed = await canWrite(active);
    if (closed) return Response.json({ error: closed }, { status: 403 });

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
      targetLabel: `${code} ${firstName} ${lastName}`,
      detail: 'อัปโหลดรูปตนเอง',
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireSelfTeacher(req);
  if (!guard.ok) return guard.response;
  try {
    const { id, code, firstName, lastName, active } = guard.teacher;
    const closed = await canWrite(active);
    if (closed) return Response.json({ error: closed }, { status: 403 });

    await db
      .update(teachers)
      .set({ photoBase64: null, photoMime: null })
      .where(eq(teachers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${code} ${firstName} ${lastName}`,
      detail: 'ลบรูปตนเอง',
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { students, teachers } from '@/db/schema';
import { requireSelf } from '@/lib/rbac';
import { notFound, handleError } from '@/lib/http';
import { photoResponse } from '@/lib/services/photos';

export const runtime = 'nodejs';

/**
 * GET /api/users/me/photo — the signed-in person's own รูปติดบัตร, read-only.
 *
 * There is deliberately no POST/DELETE: neither a teacher nor a student may
 * change their own photo. It is the school's official photograph and only an
 * admin replaces it, through teachers/[id]/photo or students/[id]/photo.
 *
 * Open to BOTH audiences — it is the person's own face, and the header on
 * /users/me shows it whichever kind of account is signed in. Not gated by the
 * self-service switch, because the header shows it whether or not editing is
 * open.
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

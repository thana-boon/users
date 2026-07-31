import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireApiScope, actorHasScope, insufficientScope, apiError } from '@/lib/apiauth';
import { handleError } from '@/lib/http';
import { photoResponse } from '@/lib/services/photos';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/students/[id]/photo — the student's profile image bytes.
 *
 * Auth: `students:read` PLUS the additive `students:photo`, mirroring how
 * `students:pii` gates เลขบัตร ปชช. A roster key does not become a face
 * database by default.
 *
 * `id` is the `id` from GET /api/public/v1/students (not รหัสนักเรียน) — that
 * list also reports `hasPhoto`, so a caller can skip the 404s entirely.
 *
 * Deliberately NOT audited per request: a nightly sync of 2000 students would
 * write 2000 audit rows and bury the entries that matter. The bulk endpoint
 * (../photos) writes one row per call and is the intended path for that job.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiScope(req, 'students:read');
  if (!guard.ok) return guard.response;
  if (!actorHasScope(guard.actor, 'students:photo')) return insufficientScope('students:photo');

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return apiError(400, 'invalid_id', 'id ต้องเป็นตัวเลข');
    }

    const row = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: { photoBase64: true, photoMime: true },
    });
    if (!row) return apiError(404, 'not_found', 'ไม่พบนักเรียนรายนี้');

    return photoResponse(req, row) ?? apiError(404, 'no_photo', 'นักเรียนรายนี้ยังไม่มีรูป');
  } catch (err) {
    return handleError(err);
  }
}

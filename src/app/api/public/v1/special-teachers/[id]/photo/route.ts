import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireApiScope, actorHasScope, insufficientScope, apiError } from '@/lib/apiauth';
import { handleError } from '@/lib/http';
import { photoResponse } from '@/lib/services/photos';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/special-teachers/[id]/photo — the อาจารย์พิเศษ's image.
 * Auth: `special-teachers:read` plus the additive `special-teachers:photo`.
 * See the students twin for the caching / non-audit rationale.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiScope(req, 'special-teachers:read');
  if (!guard.ok) return guard.response;
  if (!actorHasScope(guard.actor, 'special-teachers:photo')) {
    return insufficientScope('special-teachers:photo');
  }

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return apiError(400, 'invalid_id', 'id ต้องเป็นตัวเลข');
    }

    const row = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.id, id),
      columns: { photoBase64: true, photoMime: true },
    });
    if (!row) return apiError(404, 'not_found', 'ไม่พบอาจารย์พิเศษรายนี้');

    return photoResponse(req, row) ?? apiError(404, 'no_photo', 'อาจารย์พิเศษรายนี้ยังไม่มีรูป');
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { workers } from '@/db/schema';
import { requireApiScope, actorHasScope, insufficientScope, apiError } from '@/lib/apiauth';
import { handleError } from '@/lib/http';
import { photoResponse } from '@/lib/services/photos';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/workers/[id]/photo — the worker's profile image bytes.
 * Auth: `workers:read` plus the additive `workers:photo`. See the students
 * twin for the caching / non-audit rationale.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiScope(req, 'workers:read');
  if (!guard.ok) return guard.response;
  if (!actorHasScope(guard.actor, 'workers:photo')) return insufficientScope('workers:photo');

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return apiError(400, 'invalid_id', 'id ต้องเป็นตัวเลข');
    }

    const row = await db.query.workers.findFirst({
      where: eq(workers.id, id),
      columns: { photoBase64: true, photoMime: true },
    });
    if (!row) return apiError(404, 'not_found', 'ไม่พบคนงานรายนี้');

    return photoResponse(req, row) ?? apiError(404, 'no_photo', 'คนงานรายนี้ยังไม่มีรูป');
  } catch (err) {
    return handleError(err);
  }
}

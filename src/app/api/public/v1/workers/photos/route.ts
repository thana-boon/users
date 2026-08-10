import type { NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { workers } from '@/db/schema';
import { requireApiScope, actorHasScope, insufficientScope, apiError } from '@/lib/apiauth';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { photoDataUrl, photoEtag, parseIds, MAX_BULK_IDS } from '@/lib/services/photos';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/public/v1/workers/photos?ids=1,2,3 — several photos in one call.
 * Auth: `workers:read` plus the additive `workers:photo`. See the students
 * twin for why the bulk form exists and why only it is audited.
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'workers:read');
  if (!guard.ok) return guard.response;
  if (!actorHasScope(guard.actor, 'workers:photo')) return insufficientScope('workers:photo');

  try {
    const { ids, error } = parseIds(req.nextUrl.searchParams.get('ids'));
    if (error) return apiError(400, 'invalid_ids', error);

    const rows = await db
      .select({
        id: workers.id,
        workerCode: workers.workerCode,
        photoBase64: workers.photoBase64,
        photoMime: workers.photoMime,
      })
      .from(workers)
      .where(inArray(workers.id, ids));

    const data = rows
      .filter((r) => r.photoBase64)
      .map((r) => ({
        id: r.id,
        workerCode: r.workerCode,
        mime: r.photoMime || 'image/jpeg',
        etag: photoEtag(r.photoBase64!),
        bytes: Math.floor((r.photoBase64!.length * 3) / 4),
        dataUrl: photoDataUrl(r),
      }));

    const have = new Set(data.map((d) => d.id));
    const missing = ids.filter((id) => !have.has(id));

    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'api_read',
      targetType: 'worker',
      targetLabel: `public API · รูป ${data.length} รายการ`,
      detail: `GET /api/public/v1/workers/photos (ขอ ${ids.length}, ได้ ${data.length})`,
      req,
    });

    return Response.json({ data, missing, limit: MAX_BULK_IDS });
  } catch (err) {
    return handleError(err);
  }
}

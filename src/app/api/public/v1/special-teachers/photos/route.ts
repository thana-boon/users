import type { NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireApiScope, actorHasScope, insufficientScope, apiError } from '@/lib/apiauth';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { photoDataUrl, photoEtag, parseIds, MAX_BULK_IDS } from '@/lib/services/photos';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/public/v1/special-teachers/photos?ids=1,2,3 — several photos in one
 * call. Auth: `special-teachers:read` plus the additive
 * `special-teachers:photo`. See the students twin for why the bulk form exists
 * and why only it is audited.
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'special-teachers:read');
  if (!guard.ok) return guard.response;
  if (!actorHasScope(guard.actor, 'special-teachers:photo')) {
    return insufficientScope('special-teachers:photo');
  }

  try {
    const { ids, error } = parseIds(req.nextUrl.searchParams.get('ids'));
    if (error) return apiError(400, 'invalid_ids', error);

    const rows = await db
      .select({
        id: specialTeachers.id,
        specialTeacherCode: specialTeachers.specialTeacherCode,
        photoBase64: specialTeachers.photoBase64,
        photoMime: specialTeachers.photoMime,
      })
      .from(specialTeachers)
      .where(inArray(specialTeachers.id, ids));

    const data = rows
      .filter((r) => r.photoBase64)
      .map((r) => ({
        id: r.id,
        specialTeacherCode: r.specialTeacherCode,
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
      targetType: 'special_teacher',
      targetLabel: `public API · รูป ${data.length} รายการ`,
      detail: `GET /api/public/v1/special-teachers/photos (ขอ ${ids.length}, ได้ ${data.length})`,
      req,
    });

    return Response.json({ data, missing, limit: MAX_BULK_IDS });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireApiScope, actorHasScope, insufficientScope, apiError } from '@/lib/apiauth';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { photoDataUrl, photoEtag, parseIds, MAX_BULK_IDS } from '@/lib/services/photos';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/public/v1/students/photos?ids=1,2,3 — several photos in one call.
 *
 * Auth: `students:read` plus the additive `students:photo`.
 *
 * Why this exists next to the per-student route: syncing a 2000-student school
 * one image at a time is 2000 requests against a 600/min budget — four minutes
 * of pure rate-limit waiting. At MAX_BULK_IDS per call it is 40 requests.
 *
 * Photos come back as base64 data URLs rather than bytes (a JSON reply can't
 * carry several images otherwise), so this costs ~33% more on the wire than the
 * per-student route. Use it to sync many; use the per-student route to show one.
 *
 * Audited once per call — unlike the per-student route, which would flood the
 * log. `etag` is per photo so a caller can store it and skip unchanged rows.
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'students:read');
  if (!guard.ok) return guard.response;
  if (!actorHasScope(guard.actor, 'students:photo')) return insufficientScope('students:photo');

  try {
    const { ids, error } = parseIds(req.nextUrl.searchParams.get('ids'));
    if (error) return apiError(400, 'invalid_ids', error);

    const rows = await db
      .select({
        id: students.id,
        studentCode: students.studentCode,
        photoBase64: students.photoBase64,
        photoMime: students.photoMime,
      })
      .from(students)
      .where(inArray(students.id, ids));

    const data = rows
      .filter((r) => r.photoBase64)
      .map((r) => ({
        id: r.id,
        studentCode: r.studentCode,
        mime: r.photoMime || 'image/jpeg',
        etag: photoEtag(r.photoBase64!),
        bytes: Math.floor((r.photoBase64!.length * 3) / 4),
        dataUrl: photoDataUrl(r),
      }));

    // One list for "no such student" and "student has no photo": the caller's
    // next move is the same either way — don't ask again.
    const have = new Set(data.map((d) => d.id));
    const missing = ids.filter((id) => !have.has(id));

    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'api_read',
      targetType: 'student',
      targetLabel: `public API · รูป ${data.length} รายการ`,
      detail: `GET /api/public/v1/students/photos (ขอ ${ids.length}, ได้ ${data.length})`,
      req,
    });

    return Response.json({ data, missing, limit: MAX_BULK_IDS });
  } catch (err) {
    return handleError(err);
  }
}

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Serving stored profile photos over the public API.
 *
 * Photos live inline as base64 text (students/teachers/workers.photo_base64),
 * so every read costs a row fetch — hence the caching contract below, which is
 * the whole reason this is shared rather than written twice.
 *
 * `private` not `public`: a face is personal data and must not land in a shared
 * proxy cache. `max-age` is short and paired with a strong ETag, so a system
 * syncing 2000 photos on a schedule re-downloads only what actually changed.
 */

const CACHE_CONTROL = 'private, max-age=300, must-revalidate';

export interface StoredPhoto {
  photoBase64: string | null;
  photoMime: string | null;
}

/** Stable per-content validator — same bytes, same tag, across restarts. */
export function photoEtag(base64: string): string {
  return `"${createHash('sha1').update(base64).digest('base64url')}"`;
}

/**
 * Turn a stored photo into an image response, honouring `If-None-Match`.
 * Returns null when the person has no photo, so the caller decides between a
 * 404 and (for a bulk read) simply omitting the row.
 */
export function photoResponse(req: Request, photo: StoredPhoto | undefined | null): Response | null {
  if (!photo?.photoBase64) return null;

  const etag = photoEtag(photo.photoBase64);
  // A conditional request never touches the (potentially megabyte) base64
  // decode — the tag alone answers it.
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL },
    });
  }

  const buf = Buffer.from(photo.photoBase64, 'base64');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': photo.photoMime || 'image/jpeg',
      'Content-Length': String(buf.byteLength),
      'Cache-Control': CACHE_CONTROL,
      ETag: etag,
    },
  });
}

/** `data:image/webp;base64,...` — the bulk endpoint's per-row payload. */
export function photoDataUrl(photo: StoredPhoto): string {
  return `data:${photo.photoMime || 'image/jpeg'};base64,${photo.photoBase64}`;
}

/**
 * Parse `?ids=1,2,3`. Capped because each id costs a photo in the response
 * body: 50 x ~50KB is a ~2.5MB reply, which is about as large as a JSON
 * response should ever get.
 */
export const MAX_BULK_IDS = 50;

export function parseIds(raw: string | null): { ids: number[]; error?: string } {
  const ids = (raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { ids: [], error: 'ต้องระบุ ?ids= อย่างน้อย 1 รายการ' };
  if (unique.length > MAX_BULK_IDS) {
    return { ids: [], error: `ขอได้สูงสุด ${MAX_BULK_IDS} รายการต่อครั้ง (ส่งมา ${unique.length})` };
  }
  return { ids: unique };
}

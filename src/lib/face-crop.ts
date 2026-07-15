'use client';

import type { Detection, FaceDetector } from '@mediapipe/tasks-vision';

/**
 * Auto-crop a profile photo to the subject's face, in the browser, before it is
 * uploaded. Shared by PhotoCard (single) and PhotoImportDialog (bulk).
 *
 * Why client-side: the alternative is running a face model on the Node server,
 * where a bulk import of a few hundred photos would pin the CPU for everyone.
 * Here the cost lands on the one machine doing the uploading, and the existing
 * photo endpoints stay untouched — they just receive a smaller, better image.
 *
 * The size win is the other half of the point: photos used to be stored as the
 * raw 5MB upload, base64'd (~6.7MB per row). A cropped 480x640 WebP lands
 * around 40-60KB, ~100x smaller.
 *
 * Detection degrades rather than throws: if the model or WASM can't load
 * (offline, blocked, unsupported browser) we fall back to a geometric crop, so
 * uploading always works. Callers get `faceFound` and can say so in the UI.
 */

/**
 * Output frame — every photo is re-encoded to exactly this, no exceptions, so
 * the whole system holds one size. 3:4 is the usual ID-photo portrait ratio.
 * Changing these two numbers changes every future upload; photos already in the
 * database keep whatever size they were stored at.
 */
const TARGET_W = 480;
const TARGET_H = 640;
const TARGET_RATIO = TARGET_W / TARGET_H;

/**
 * How much taller than the detected face box the crop should be. BlazeFace
 * reports roughly eyebrows-to-chin, so the full head is ~1.5x that; at 2.4 the
 * head fills ~62% of the frame, which is about what an ID photo looks like.
 * Cropping to the raw box gives an unsettling face-filling-the-frame result.
 */
const CROP_TO_FACE_RATIO = 2.4;

/**
 * Where the face box's centre sits vertically in the crop, as a fraction from
 * the top. Slightly above middle so there is headroom above the hair instead of
 * dead space under the chin.
 */
const FACE_CENTRE_Y = 0.46;

/** No-face fallback: heads sit near the top of a portrait, so bias upward. */
const FALLBACK_TOP_BIAS = 0.25;

/**
 * BlazeFace full-range, not the short-range model the MediaPipe samples use.
 * Measured on a test portrait composited at varying sizes, short-range loses
 * the face once the head drops below ~25% of frame height — which is every
 * half-body and full-body photo, i.e. a lot of what gets handed in. Full-range
 * holds on down to ~10% (and still nails close-ups) for ~8ms more per photo and
 * 800KB more model. Both fail below ~8%, which is a person too small to crop
 * usefully anyway.
 */
const MODEL_URL = '/mediapipe/blaze_face_full_range.tflite';
const WASM_PATH = '/mediapipe/wasm';

export interface CropResult {
  /** The cropped image, ready to hand to FormData. */
  file: File;
  /** False when we fell back to a geometric crop — worth surfacing to the user. */
  faceFound: boolean;
  /** More than one face in frame; the largest was used. Likely the wrong photo. */
  multipleFaces: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

let detectorPromise: Promise<FaceDetector | null> | null = null;

/**
 * Load the detector once per page, and remember failure as `null` rather than
 * retrying on every photo — a bulk import of 300 files should not attempt 300
 * doomed 11MB WASM fetches.
 *
 * The library is imported dynamically to keep its ~140KB bundle off the
 * student/teacher/worker list pages, which pull in this module but where most
 * visits never touch a photo.
 */
function getDetector(): Promise<FaceDetector | null> {
  detectorPromise ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision').catch(() => null);
    if (!vision) return null;

    // GPU is the fast path but the delegate is missing or blocked on plenty of
    // school hardware; CPU is slower and always there.
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
        return await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.5,
        });
      } catch {
        continue;
      }
    }
    return null;
  })();
  return detectorPromise;
}

/** Warm the model up ahead of the first upload (e.g. when a dialog opens). */
export function preloadFaceDetector(): void {
  void getDetector();
}

/** Largest detection wins: background bystanders are smaller than the subject. */
function largestFace(detections: Detection[]): Box | null {
  let best: Box | null = null;
  for (const d of detections) {
    const b = d.boundingBox;
    if (!b) continue;
    if (!best || b.width * b.height > best.w * best.h) {
      best = { x: b.originX, y: b.originY, w: b.width, h: b.height };
    }
  }
  return best;
}

/**
 * Fit a 3:4 box around the face, then push it back inside the image. Shifting
 * beats shrinking here — a face near the edge should stay framed at the right
 * scale rather than getting a tighter crop than everyone else's photo.
 */
function faceCropBox(face: Box, imgW: number, imgH: number): Box {
  let h = face.h * CROP_TO_FACE_RATIO;
  let w = h * TARGET_RATIO;

  // Only shrink if the ideal box genuinely can't fit, keeping the aspect ratio.
  if (w > imgW) { w = imgW; h = w / TARGET_RATIO; }
  if (h > imgH) { h = imgH; w = h * TARGET_RATIO; }

  const faceCx = face.x + face.w / 2;
  const faceCy = face.y + face.h / 2;
  const x = clamp(faceCx - w / 2, 0, imgW - w);
  const y = clamp(faceCy - FACE_CENTRE_Y * h, 0, imgH - h);
  return { x, y, w, h };
}

/** No face: biggest 3:4 box, centred horizontally, biased toward the top. */
function fallbackCropBox(imgW: number, imgH: number): Box {
  let w = imgW;
  let h = w / TARGET_RATIO;
  if (h > imgH) { h = imgH; w = h * TARGET_RATIO; }
  return {
    x: (imgW - w) / 2,
    y: (imgH - h) * FALLBACK_TOP_BIAS,
    w,
    h,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  // hi < lo when the box fills the axis exactly; lo wins.
  return Math.max(lo, Math.min(hi, v));
}

let webpSupport: boolean | null = null;

/** Safari only got canvas WebP encoding in 16.4; fall back to JPEG below that. */
function supportsWebp(): boolean {
  if (webpSupport === null) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpSupport;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('แปลงรูปไม่สำเร็จ'))),
      type,
      quality,
    );
  });
}

/** Keep the person's code (the filename minus extension) — bulk import matches on it. */
function renameTo(original: string, ext: string): string {
  const base = original.split(/[\\/]/).pop() ?? original;
  return `${base.replace(/\.[^.]+$/, '')}.${ext}`;
}

/**
 * Crop `file` to the subject's face and re-encode it at exactly TARGET_W x
 * TARGET_H. Every stored photo goes through here, so every stored photo has
 * those dimensions — that uniformity is the point, and the UI can rely on it.
 *
 * Losing the face is NOT a failure: we fall back to a geometric crop and say so
 * via `faceFound`, because a centre-cropped photo at the right size still beats
 * refusing the upload. Failing to produce the frame at all IS a failure and
 * throws, rather than quietly letting an odd-sized original through and
 * breaking the one guarantee this module makes.
 */
export async function cropToFace(file: File): Promise<CropResult> {
  let bitmap: ImageBitmap;
  try {
    // Phone photos lean on EXIF rotation; without this the crop maths would be
    // done against a sideways image.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ หรือไฟล์เสียหาย');
  }

  try {
    const detector = await getDetector();
    let face: Box | null = null;
    let multipleFaces = false;

    if (detector) {
      try {
        const result = detector.detect(bitmap);
        face = largestFace(result.detections);
        multipleFaces = result.detections.length > 1;
      } catch {
        face = null; // Detection failed for this image; geometric crop still fine.
      }
    }

    const box = face
      ? faceCropBox(face, bitmap.width, bitmap.height)
      : fallbackCropBox(bitmap.width, bitmap.height);

    const canvas = document.createElement('canvas');
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('เบราว์เซอร์นี้ไม่รองรับการครอบตัดรูป');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, TARGET_W, TARGET_H);

    const type = supportsWebp() ? 'image/webp' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, type, 0.85);
    const ext = type === 'image/webp' ? 'webp' : 'jpg';

    return {
      file: new File([blob], renameTo(file.name, ext), { type }),
      faceFound: face !== null,
      multipleFaces,
    };
  } finally {
    bitmap.close();
  }
}

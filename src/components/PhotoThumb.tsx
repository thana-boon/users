'use client';

import { useEffect } from 'react';

/**
 * Small 3:4 profile thumbnail for list tables (ครู / นักเรียน / คนงาน), plus the
 * lightbox that shows the full image. Photos are stored inline as base64 and
 * served per-row from `/api/users/<kind>/<id>/photo`, so a row without a photo
 * must not request the URL at all — it 404s. Falls back to initials instead.
 */
export function PhotoThumb({
  src, initials, alt, onClick,
}: {
  /** Photo endpoint, or null when the record has no photo. */
  src: string | null;
  initials: string;
  alt: string;
  /** When given, the thumbnail becomes a button that opens the lightbox. */
  onClick?: () => void;
}) {
  const box = (
    <div
      style={{
        width: 32, height: 40, borderRadius: 6, overflow: 'hidden',
        background: 'var(--skdw-purple-pale)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--skdw-border)', flexShrink: 0,
      }}
    >
      {src
        ? <img src={src} alt={alt} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--skdw-purple)' }}>{initials || '—'}</span>}
    </div>
  );

  if (!onClick || !src) return box;
  return (
    <button
      type="button"
      onClick={onClick}
      title="ดูรูปขนาดใหญ่"
      aria-label={`ดูรูปขนาดใหญ่ของ ${alt}`}
      style={{ padding: 0, border: 0, background: 'none', cursor: 'zoom-in', display: 'block', borderRadius: 6 }}
    >
      {box}
    </button>
  );
}

export function PhotoLightbox({
  src, alt, caption, onClose,
}: {
  src: string;
  alt: string;
  caption?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="card-header row-between">
          <span>{caption ?? alt}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} autoFocus>ปิด</button>
        </div>
        <div className="card-pad" style={{ display: 'flex', justifyContent: 'center' }}>
          <img
            src={src}
            alt={alt}
            // width:100% (not max-width) so bulk-imported photos, which are not
            // normalised to the 480x640 the upload cropper produces, all fill
            // the frame instead of rendering at their natural size.
            style={{ width: '100%', height: 'auto', maxHeight: '70vh', objectFit: 'contain', borderRadius: 10 }}
          />
        </div>
      </div>
    </div>
  );
}

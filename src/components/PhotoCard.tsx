'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/client';
import { useToast } from './Toast';

/**
 * Square-ish profile photo with อัปโหลด/เปลี่ยน/ลบ, shared by ครู/คนงาน detail
 * pages. `baseEndpoint` is the photo route without a trailing slash, e.g.
 * `/api/users/teachers/12/photo`. Falls back to `initials` when no photo.
 */
export function PhotoCard({
  baseEndpoint, hasPhoto, initials, alt, onChange,
}: {
  baseEndpoint: string;
  hasPhoto: boolean;
  initials: string;
  alt: string;
  onChange: (hasPhoto: boolean) => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ver, setVer] = useState(0);
  const [busy, setBusy] = useState(false);
  const photoUrl = hasPhoto ? `${baseEndpoint}?v=${ver}` : null;

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(baseEndpoint, { method: 'POST', body: fd });
      onChange(true);
      setVer((v) => v + 1);
      toast('อัปโหลดรูปแล้ว', 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(baseEndpoint, { method: 'DELETE' });
      onChange(false);
      setVer((v) => v + 1);
      toast('ลบรูปแล้ว', 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack" style={{ gap: 8, alignItems: 'center', width: 116 }}>
      <div style={{
        width: 116, height: 140, borderRadius: 12, overflow: 'hidden', background: 'var(--skdw-purple-pale)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--skdw-border)',
      }}>
        {photoUrl
          ? <img src={photoUrl} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 34, fontWeight: 700, color: 'var(--skdw-purple)' }}>{initials || '—'}</span>}
      </div>
      <input
        ref={inputRef} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
      />
      <div className="row" style={{ gap: 4 }}>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => inputRef.current?.click()} disabled={busy}>
          {hasPhoto ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
        </button>
        {hasPhoto && <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '4px 8px', color: 'var(--color-error)' }} onClick={remove} disabled={busy}>ลบ</button>}
      </div>
    </div>
  );
}

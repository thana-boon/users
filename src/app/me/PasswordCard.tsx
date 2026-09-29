'use client';

import { useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconEye, IconEyeOff } from '@/components/Icons';

/**
 * เปลี่ยนรหัสผ่าน — its own card and its own request, because it is the one
 * change on this page that takes a proof (the current password) rather than
 * just a new value.
 *
 * Shown whether or not the school's self-edit window is open: closing that
 * window is about who may revise the school's records, and leaving someone
 * stuck with a password they think has leaked is not what it is for.
 */
export function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  // One switch for all three boxes: on a phone keyboard, typing a password
  // blind is how "ยืนยัน" ends up not matching.
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  // Said under the box as soon as the second entry is as long as the first,
  // rather than in a toast after pressing the button.
  const mismatch = confirm.length > 0 && confirm.length >= next.length && confirm !== next;
  const tooShort = next.length > 0 && next.length < 6;

  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    try {
      await api('/api/users/me/password', jsonBody({ currentPassword: current, newPassword: next }));
      toast('เปลี่ยนรหัสผ่านแล้ว', 'success');
      setCurrent(''); setNext(''); setConfirm(''); setShow(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const type = show ? 'text' : 'password';

  return (
    <section className="card me-section" aria-label="เปลี่ยนรหัสผ่าน">
      <h2 className="section-title">เปลี่ยนรหัสผ่าน</h2>
      {!hasPassword ? (
        <p className="muted" style={{ fontSize: 'var(--text-sm)', margin: 0 }}>
          บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ
        </p>
      ) : (
        <form onSubmit={change}>
          <div className="grid-2 me-fields">
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="pw-current">รหัสผ่านปัจจุบัน</label>
              <input
                id="pw-current"
                className="form-input"
                type={type}
                autoComplete="current-password"
                autoCapitalize="none"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="pw-new">รหัสผ่านใหม่</label>
              <input
                id="pw-new"
                className={`form-input${tooShort ? ' error' : ''}`}
                type={type}
                autoComplete="new-password"
                autoCapitalize="none"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-describedby="pw-new-hint"
                aria-invalid={tooShort || undefined}
              />
              <p className={tooShort ? 'form-error' : 'form-hint'} id="pw-new-hint">อย่างน้อย 6 ตัวอักษร</p>
            </div>
            <div>
              <label className="form-label" htmlFor="pw-confirm">ยืนยันรหัสผ่านใหม่</label>
              <input
                id="pw-confirm"
                className={`form-input${mismatch ? ' error' : ''}`}
                type={type}
                autoComplete="new-password"
                autoCapitalize="none"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-describedby="pw-confirm-msg"
                aria-invalid={mismatch || undefined}
              />
              <p className="form-error" id="pw-confirm-msg" role="alert">
                {mismatch ? 'ยังไม่ตรงกับรหัสผ่านใหม่ — พิมพ์ให้เหมือนกันทั้งสองช่อง' : ''}
              </p>
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={busy || !current || !next || next !== confirm || tooShort}
              aria-busy={busy}
            >
              {busy ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShow((v) => !v)}
              aria-pressed={show}
            >
              {show ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
              {show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

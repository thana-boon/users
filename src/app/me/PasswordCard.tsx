'use client';

import { useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';

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
  const [busy, setBusy] = useState(false);

  async function change() {
    if (next !== confirm) {
      toast('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/api/users/me/password', jsonBody({ currentPassword: current, newPassword: next }));
      toast('เปลี่ยนรหัสผ่านแล้ว', 'success');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title">เปลี่ยนรหัสผ่าน</h2>
      {!hasPassword ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ
        </p>
      ) : (
        <>
          <div className="grid-2" style={{ gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">รหัสผ่านปัจจุบัน</label>
              <input
                className="form-input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">รหัสผ่านใหม่</label>
              <input
                className="form-input"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <p className="form-hint">อย่างน้อย 6 ตัวอักษร</p>
            </div>
            <div>
              <label className="form-label">ยืนยันรหัสผ่านใหม่</label>
              <input
                className="form-input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 12 }}
            onClick={change}
            disabled={busy || !current || !next}
          >
            {busy ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
          </button>
        </>
      )}
    </div>
  );
}

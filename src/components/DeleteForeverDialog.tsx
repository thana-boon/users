'use client';

import { useState } from 'react';
import { api } from '@/lib/client';
import { useToast } from './Toast';
import { IconTrash } from './Icons';

/**
 * ลบถาวร (hard delete) a record already sitting in the trash. Deliberately
 * high-friction: the admin must type the record's exact code before the button
 * unlocks. Backend re-checks the code + archived state (src/app/api/users/
 * archived DELETE). Data does NOT come back — this is not the ย้ายไปถังขยะ soft-delete.
 */
export function DeleteForeverDialog({
  type, id, code, label, onClose, onDone,
}: {
  type: 'student' | 'teacher' | 'worker';
  id: number;
  code: string;
  label: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const kind = type === 'student' ? 'นักเรียน' : type === 'teacher' ? 'ครู' : 'คนงาน';
  const match = typed.trim() === code;

  async function submit() {
    if (!match) return;
    setBusy(true);
    try {
      await api('/api/users/archived', {
        method: 'DELETE',
        body: JSON.stringify({ type, id, confirmCode: typed.trim() }),
      });
      toast('ลบถาวรแล้ว', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="ลบถาวร">
      <div className="modal">
        <div className="card-header" style={{ color: 'var(--color-error)' }}>
          <IconTrash width={18} height={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          ลบถาวร — กู้คืนไม่ได้
        </div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div
            style={{
              background: 'var(--color-error-bg)',
              border: '0.5px solid var(--color-error)',
              borderRadius: 'var(--radius-sm)',
              padding: 12,
              fontSize: 13,
            }}
          >
            คุณกำลังจะ<strong>ลบ{kind}ออกจากฐานข้อมูลอย่างถาวร</strong> — <strong>{label}</strong>
            <br />
            ข้อมูลทั้งหมด{type === 'student' ? ' (การลงทะเบียนทุกปี ผู้ปกครอง ที่อยู่ สุขภาพ ประวัติจบช่วงชั้น) ' : ' '}
            จะถูกลบและ<strong>กู้คืนไม่ได้อีก</strong> หากรายการนี้เคยถูกใช้งานในระบบอื่น (เช่น คะแนน/ScoreBridge)
            การอ้างอิงเหล่านั้นจะเสียไปด้วย — ควรใช้เฉพาะกรณีสร้างผิดที่ยังไม่ได้ใช้งานจริง.
          </div>
          <div>
            <label className="form-label">
              พิมพ์รหัส{kind} <span className="mono" style={{ color: 'var(--color-error)' }}>{code}</span> เพื่อยืนยัน
            </label>
            <input
              className="form-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={code}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn btn-sm btn-danger" onClick={submit} disabled={busy || !match}>
              {busy ? 'กำลังลบ…' : 'ลบถาวร'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

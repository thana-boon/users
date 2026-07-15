'use client';

import { useState } from 'react';
import { api } from '@/lib/client';
import { useToast } from './Toast';
import { IconTrash } from './Icons';

const BULK_CONFIRM_PHRASE = 'ลบทั้งหมด';

/**
 * ลบทั้งหมด (empty the trash) — permanently hard-deletes every record in one tab
 * of the ถังขยะ. High-friction on purpose: the admin must type the exact phrase
 * "ลบทั้งหมด" before the button unlocks. Backend re-checks the phrase + archived
 * state (src/app/api/users/archived DELETE, all-mode). Data does NOT come back.
 */
export function BulkDeleteForeverDialog({
  type, count, onClose, onDone,
}: {
  type: 'student' | 'teacher' | 'worker';
  count: number;
  onClose: () => void;
  onDone: (deleted: number) => void;
}) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const kind = type === 'student' ? 'นักเรียน' : type === 'teacher' ? 'ครู' : 'คนงาน';
  const match = typed.trim() === BULK_CONFIRM_PHRASE;

  async function submit() {
    if (!match) return;
    setBusy(true);
    try {
      const res = await api<{ count: number }>('/api/users/archived', {
        method: 'DELETE',
        body: JSON.stringify({ type, all: true, confirmCode: typed.trim() }),
      });
      toast(`ลบถาวรแล้ว ${res.count} รายการ`, 'success');
      onDone(res.count);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="ลบทั้งหมด">
      <div className="modal">
        <div className="card-header" style={{ color: 'var(--color-error)' }}>
          <IconTrash width={18} height={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          ลบทั้งหมดในถังขยะ — กู้คืนไม่ได้
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
            คุณกำลังจะ<strong>ลบ{kind}ทั้งหมด {count} รายการออกจากฐานข้อมูลอย่างถาวร</strong>
            <br />
            ข้อมูลทั้งหมด{type === 'student' ? ' (การลงทะเบียนทุกปี ผู้ปกครอง ที่อยู่ สุขภาพ ประวัติจบช่วงชั้น) ' : ' '}
            จะถูกลบและ<strong>กู้คืนไม่ได้อีก</strong> หากรายการเหล่านี้เคยถูกใช้งานในระบบอื่น (เช่น คะแนน/ScoreBridge)
            การอ้างอิงเหล่านั้นจะเสียไปด้วย — ควรใช้เฉพาะกรณีสร้างผิดที่ยังไม่ได้ใช้งานจริง.
          </div>
          <div>
            <label className="form-label">
              พิมพ์ <span className="mono" style={{ color: 'var(--color-error)' }}>{BULK_CONFIRM_PHRASE}</span> เพื่อยืนยัน
            </label>
            <input
              className="form-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={BULK_CONFIRM_PHRASE}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn btn-sm btn-danger" onClick={submit} disabled={busy || !match}>
              {busy ? 'กำลังลบ…' : `ลบทั้งหมด ${count} รายการ`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

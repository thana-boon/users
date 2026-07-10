'use client';

import { useEffect, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';

interface YearOpt { id: number; year: number; isActive: boolean }

/**
 * บันทึกการลาออก (resign) ของครู/คนงาน — ใช้ร่วมกันทั้งสองหน้า ผ่าน prop `endpoint`
 * (เช่น `/api/users/teachers/12/status` หรือ `/api/users/workers/5/status`).
 * บันทึก วันที่ออก + ปีการศึกษาที่ออก (+ เหตุผล) ที่ POST status:'resigned'.
 * การคืนสถานะทำงานทำเป็นปุ่มยืนยันเดียวในหน้า detail (ไม่ผ่านไดอะล็อกนี้).
 */
export function EmploymentStatusDialog({
  endpoint, onClose, onDone,
}: {
  endpoint: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [exitDate, setExitDate] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [years, setYears] = useState<YearOpt[]>([]);
  const [exitYearId, setExitYearId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ years: YearOpt[] }>('/api/users/meta')
      .then((m) => {
        setYears(m.years);
        const active = m.years.find((y) => y.isActive);
        setExitYearId(active?.id ?? m.years[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  async function submit() {
    if (!exitDate.trim()) return toast('กรุณาระบุวันที่ออก', 'error');
    if (exitYearId == null) return toast('กรุณาระบุปีการศึกษาที่ออก', 'error');
    setBusy(true);
    try {
      await api(endpoint, jsonBody({
        status: 'resigned',
        exitDate,
        exitReason,
        academicYearId: exitYearId,
      }));
      toast('บันทึกการลาออกแล้ว', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="บันทึกการลาออก">
      <div className="modal">
        <div className="card-header">บันทึกการลาออก</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div>
            <label className="form-label">ปีการศึกษาที่ออก</label>
            <select className="form-select" value={exitYearId ?? ''} onChange={(e) => setExitYearId(Number(e.target.value))}>
              {years.length === 0 && <option value="">—</option>}
              {years.map((y) => <option key={y.id} value={y.id}>{y.year}{y.isActive ? ' (ปัจจุบัน)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">วันที่ออก (ว/ด/ปพ.ศ.)</label>
            <input className="form-input" placeholder="เช่น 31/03/2569" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
          </div>
          <div>
            <label className="form-label">เหตุผล (ถ้ามี)</label>
            <textarea className="form-input" rows={2} value={exitReason} onChange={(e) => setExitReason(e.target.value)} />
          </div>
          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn btn-danger btn-sm" onClick={submit} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : 'ยืนยันลาออก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

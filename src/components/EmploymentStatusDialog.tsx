'use client';

import { useEffect, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';
import { Combo } from './Combo';
import { DateField } from './DateField';
import { todayThai } from '@/lib/thai';
import { STAFF_EXIT_REASON_OPTIONS } from '@/lib/options';

interface YearOpt { id: number; year: number; isActive: boolean; activeTerm: number }

/**
 * บันทึกการลาออก (resign) ของครู/คนงาน/อาจารย์พิเศษ — ใช้ร่วมกันทุกหน้า ผ่าน prop `endpoint`
 * (เช่น `/api/users/teachers/12/status` หรือ `/api/users/workers/5/status`).
 * บันทึก วันที่ออก + ปีการศึกษา/ภาคเรียนที่ออก (+ เหตุผล) ที่ POST status:'resigned'.
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
  const [exitDate, setExitDate] = useState(todayThai);
  const [exitReason, setExitReason] = useState('');
  const [years, setYears] = useState<YearOpt[]>([]);
  const [exitYearId, setExitYearId] = useState<number | null>(null);
  const [exitTerm, setExitTerm] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ years: YearOpt[] }>('/api/users/meta')
      .then((m) => {
        setYears(m.years);
        const active = m.years.find((y) => y.isActive);
        setExitYearId(active?.id ?? m.years[0]?.id ?? null);
        if (active) setExitTerm(active.activeTerm);
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
        term: exitTerm,
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
            <label className="form-label">ภาคเรียนที่ออก</label>
            <select className="form-select" value={exitTerm} onChange={(e) => setExitTerm(Number(e.target.value))}>
              <option value={1}>ภาคเรียนที่ 1</option>
              <option value={2}>ภาคเรียนที่ 2</option>
            </select>
          </div>
          <DateField label="วันที่ออก" value={exitDate} onChange={setExitDate} today />
          <Combo
            label="เหตุผล (ถ้ามี)"
            value={exitReason}
            onChange={setExitReason}
            options={STAFF_EXIT_REASON_OPTIONS}
            normalize={false}
            placeholder="เลือกจากรายการหรือพิมพ์เอง"
          />
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

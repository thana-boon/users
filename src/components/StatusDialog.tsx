'use client';

import { useEffect, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';
import { keyStageOf, KEY_STAGE_LABEL_TH } from '@/lib/grades';

interface YearOpt { id: number; year: number; isActive: boolean }

/**
 * จำหน่าย/ลาออก or จบการศึกษา a student. Records exit type/date/reason (fed to
 * the future document-export API). Graduation can also record a จบช่วงชั้น
 * milestone for the student's current key stage.
 */
export function StatusDialog({
  studentId, mode, activeGrade, activeYearId, onClose, onDone,
}: {
  studentId: number;
  mode: 'withdrawn' | 'graduated';
  activeGrade: string | null;
  activeYearId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const graduate = mode === 'graduated';
  const stage = keyStageOf(activeGrade);
  const [exitType, setExitType] = useState(graduate ? 'จบการศึกษา' : 'ลาออก');
  const [exitDate, setExitDate] = useState('');
  const [exitReason, setExitReason] = useState(graduate ? 'สำเร็จการศึกษา' : '');
  const [recordCompletion, setRecordCompletion] = useState(graduate && !!stage);
  const [years, setYears] = useState<YearOpt[]>([]);
  const [exitYearId, setExitYearId] = useState<number | null>(activeYearId);
  const [busy, setBusy] = useState(false);

  // Year list for the "ปีการศึกษาที่ออก" selector (default = the passed active year).
  useEffect(() => {
    api<{ years: YearOpt[] }>('/api/users/meta').then((m) => setYears(m.years)).catch(() => {});
  }, []);

  const WITHDRAW_TYPES = ['ลาออก', 'พักการเรียน', 'เสียชีวิต', 'ย้ายสถานศึกษา', 'นักเรียนไปโครงการ', 'จำหน่าย', 'อื่น ๆ'];

  async function submit() {
    if (!exitDate.trim()) return toast('กรุณาระบุวันที่ออก', 'error');
    if (!exitReason.trim()) return toast('กรุณาระบุเหตุผล', 'error');
    setBusy(true);
    try {
      await api(`/api/users/students/${studentId}/status`, jsonBody({
        status: mode,
        exitType,
        exitDate,
        exitReason,
        academicYearId: exitYearId,
        completion: recordCompletion && stage
          ? { keyStage: stage, gradeLevel: activeGrade, academicYearId: exitYearId, completionDate: exitDate }
          : null,
      }));
      toast(graduate ? 'บันทึกจบการศึกษาแล้ว' : 'บันทึกจำหน่าย/ลาออกแล้ว', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={graduate ? 'จบการศึกษา' : 'จำหน่าย/ลาออก'}>
      <div className="modal">
        <div className="card-header">{graduate ? 'จบการศึกษา' : 'จำหน่าย / ลาออก'}</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div>
            <label className="form-label">ปีการศึกษาที่ออก</label>
            <select className="form-select" value={exitYearId ?? ''} onChange={(e) => setExitYearId(Number(e.target.value))}>
              {years.length === 0 && activeYearId != null && <option value={activeYearId}>—</option>}
              {years.map((y) => <option key={y.id} value={y.id}>{y.year}{y.isActive ? ' (ปัจจุบัน)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">ประเภท</label>
            {graduate ? (
              <input className="form-input" value={exitType} onChange={(e) => setExitType(e.target.value)} />
            ) : (
              <select className="form-select" value={exitType} onChange={(e) => setExitType(e.target.value)}>
                {WITHDRAW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="form-label">วันที่ออก (ว/ด/ปพ.ศ.)</label>
            <input className="form-input" placeholder="เช่น 31/03/2569" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
          </div>
          <div>
            <label className="form-label">เหตุผล</label>
            <textarea className="form-input" rows={2} value={exitReason} onChange={(e) => setExitReason(e.target.value)} />
          </div>
          {stage && (
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={recordCompletion} onChange={(e) => setRecordCompletion(e.target.checked)} />
              <span>บันทึก “จบ{KEY_STAGE_LABEL_TH[stage]}” ({activeGrade})</span>
            </label>
          )}
          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className={`btn btn-sm ${graduate ? 'btn-primary' : 'btn-danger'}`} onClick={submit} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : 'ยืนยัน'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

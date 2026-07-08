'use client';

import { useEffect, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconPlus } from '@/components/Icons';

interface Year {
  id: number; year: number; startDate: string | null; endDate: string | null;
  isActive: boolean; isArchived: boolean; studentCount: number;
}

export default function AcademicYearsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Year[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    api<{ data: Year[] }>('/api/users/academic-years').then((r) => setRows(r.data)).catch((e) => toast(e.message, 'error'));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function setActive(id: number) {
    setBusy(true);
    try {
      await api(`/api/users/academic-years/${id}`, { method: 'PATCH', body: JSON.stringify({ setActive: true }) });
      toast('ตั้งเป็นปีปัจจุบันแล้ว', 'success');
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  async function toggleArchive(y: Year) {
    try {
      await api(`/api/users/academic-years/${y.id}`, { method: 'PATCH', body: JSON.stringify({ isArchived: !y.isArchived }) });
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 820 }}>
      <div className="row-between">
        <h1 className="page-title">ปีการศึกษา</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><IconPlus width={16} height={16} /> เพิ่มปีการศึกษา</button>
      </div>

      <div className="alert alert-info" style={{ fontSize: 13 }}>
        การลบใช้ soft-delete (archive) เสมอ — ไม่ลบจริง เพื่อคง enrollment_id สำหรับระบบปลายน้ำ (เช่น ScoreBridge)
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>ปี</th><th>เปิดเทอม</th><th>สิ้นสุด</th><th className="num">นักเรียน</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>
              {rows.map((y) => (
                <tr key={y.id} style={{ opacity: y.isArchived ? 0.55 : 1 }}>
                  <td><b>{y.year}</b></td>
                  <td>{y.startDate ?? '-'}</td>
                  <td>{y.endDate ?? '-'}</td>
                  <td className="num mono">{y.studentCount.toLocaleString('th-TH')}</td>
                  <td>
                    {y.isActive && <span className="badge badge-success">ปัจจุบัน</span>}
                    {y.isArchived && <span className="badge badge-muted">เก็บถาวร</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {!y.isActive && !y.isArchived && (
                        <button className="btn btn-secondary btn-sm" onClick={() => setActive(y.id)} disabled={busy}>ตั้งเป็นปัจจุบัน</button>
                      )}
                      {!y.isActive && (
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleArchive(y)}>{y.isArchived ? 'กู้คืน' : 'เก็บถาวร'}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>ยังไม่มีปีการศึกษา</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewYear
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); toast('เพิ่มปีการศึกษาแล้ว', 'success'); }}
        />
      )}
    </div>
  );
}

function NewYear({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [year, setYear] = useState('2570');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api('/api/users/academic-years', jsonBody({
        year: Number(year), startDate: start || null, endDate: end || null, setActive: active,
      }));
      onCreated();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="เพิ่มปีการศึกษา">
      <div className="modal">
        <div className="card-header">เพิ่มปีการศึกษา</div>
        <div className="card-pad stack">
          <div>
            <label className="form-label required">ปี (พ.ศ.)</label>
            <input className="form-input" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div className="grid-2">
            <div><label className="form-label">เปิดเทอม</label><input className="form-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><label className="form-label">สิ้นสุด</label><input className="form-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>ตั้งเป็นปีปัจจุบันทันที</span>
          </label>
        </div>
        <div className="row-between card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>บันทึก</button>
        </div>
      </div>
    </div>
  );
}

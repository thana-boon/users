'use client';

import { useEffect, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconPlus, IconEdit } from '@/components/Icons';

interface Year {
  id: number; year: number; startDate: string | null; endDate: string | null;
  term1Start: string | null; term1End: string | null;
  term2Start: string | null; term2End: string | null;
  isActive: boolean; isArchived: boolean; studentCount: number;
}

/** "2569-05-16" → "16 พ.ค. 69" (already-Buddhist input stays as-is per <input type=date>). */
function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtRange(start: string | null, end: string | null): string {
  if (!start && !end) return '-';
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

export default function AcademicYearsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Year[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Year | null>(null);
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
    <div className="stack" style={{ gap: 20, maxWidth: 1000 }}>
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
            <thead><tr><th>ปี</th><th>ทั้งปี (เปิด–สิ้นสุด)</th><th>เทอม 1</th><th>เทอม 2</th><th className="num">นักเรียน</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>
              {rows.map((y) => (
                <tr key={y.id} style={{ opacity: y.isArchived ? 0.55 : 1 }}>
                  <td><b>{y.year}</b></td>
                  <td style={{ fontSize: 13 }}>{fmtRange(y.startDate, y.endDate)}</td>
                  <td style={{ fontSize: 13 }}>{fmtRange(y.term1Start, y.term1End)}</td>
                  <td style={{ fontSize: 13 }}>{fmtRange(y.term2Start, y.term2End)}</td>
                  <td className="num mono">{y.studentCount.toLocaleString('th-TH')}</td>
                  <td>
                    {y.isActive && <span className="badge badge-success">ปัจจุบัน</span>}
                    {y.isArchived && <span className="badge badge-muted">เก็บถาวร</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(y)} title="แก้ไขวันเปิด–ปิดเทอม"><IconEdit width={14} height={14} /> แก้ไข</button>
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
              {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 32 }}>ยังไม่มีปีการศึกษา</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <YearDialog
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); load(); toast('เพิ่มปีการศึกษาแล้ว', 'success'); }}
        />
      )}
      {editing && (
        <YearDialog
          existing={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); toast('บันทึกแล้ว', 'success'); }}
        />
      )}
    </div>
  );
}

/** Create (no `existing`) or edit dates of an existing year. */
function YearDialog({ existing, onClose, onDone }: { existing?: Year; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [year, setYear] = useState(existing ? String(existing.year) : '2570');
  const [start, setStart] = useState(existing?.startDate ?? '');
  const [end, setEnd] = useState(existing?.endDate ?? '');
  const [t1Start, setT1Start] = useState(existing?.term1Start ?? '');
  const [t1End, setT1End] = useState(existing?.term1End ?? '');
  const [t2Start, setT2Start] = useState(existing?.term2Start ?? '');
  const [t2End, setT2End] = useState(existing?.term2End ?? '');
  const [active, setActiveFlag] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const dates = {
        startDate: start || null, endDate: end || null,
        term1Start: t1Start || null, term1End: t1End || null,
        term2Start: t2Start || null, term2End: t2End || null,
      };
      if (existing) {
        await api(`/api/users/academic-years/${existing.id}`, { ...jsonBody(dates), method: 'PATCH' });
      } else {
        await api('/api/users/academic-years', jsonBody({ year: Number(year), ...dates, setActive: active }));
      }
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  const title = existing ? `แก้ไขปีการศึกษา ${existing.year}` : 'เพิ่มปีการศึกษา';
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <div className="card-header">{title}</div>
        <div className="card-pad stack">
          {!existing && (
            <div>
              <label className="form-label required">ปี (พ.ศ.)</label>
              <input className="form-input" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
          )}
          <div>
            <div className="form-label" style={{ marginBottom: 6 }}>ทั้งปีการศึกษา</div>
            <div className="grid-2">
              <div><label className="form-label">เปิดเทอม</label><input className="form-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><label className="form-label">สิ้นสุด</label><input className="form-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            </div>
          </div>
          <div>
            <div className="form-label" style={{ marginBottom: 6 }}>ภาคเรียนที่ 1</div>
            <div className="grid-2">
              <div><label className="form-label">วันเริ่ม</label><input className="form-input" type="date" value={t1Start} onChange={(e) => setT1Start(e.target.value)} /></div>
              <div><label className="form-label">วันสิ้นสุด</label><input className="form-input" type="date" value={t1End} onChange={(e) => setT1End(e.target.value)} /></div>
            </div>
          </div>
          <div>
            <div className="form-label" style={{ marginBottom: 6 }}>ภาคเรียนที่ 2</div>
            <div className="grid-2">
              <div><label className="form-label">วันเริ่ม</label><input className="form-input" type="date" value={t2Start} onChange={(e) => setT2Start(e.target.value)} /></div>
              <div><label className="form-label">วันสิ้นสุด</label><input className="form-input" type="date" value={t2End} onChange={(e) => setT2End(e.target.value)} /></div>
            </div>
          </div>
          {!existing && (
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={(e) => setActiveFlag(e.target.checked)} />
              <span>ตั้งเป็นปีปัจจุบันทันที</span>
            </label>
          )}
        </div>
        <div className="row-between card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>บันทึก</button>
        </div>
      </div>
    </div>
  );
}

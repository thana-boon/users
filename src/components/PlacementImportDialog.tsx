'use client';

import { useMemo, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';

/**
 * นำเข้า CSV เพื่อจัดนักเรียนเข้าห้อง — for placing many students across rooms at
 * once (e.g. a ป.6/1 cohort scattering into ม.1/2, ม.1/3, ม.1/4 across a ช่วงชั้น
 * boundary). CSV has 3 columns: รหัสนักเรียน, ชั้น, ห้อง. The file is parsed here
 * and validated server-side (dryRun) before committing. Students must already
 * exist in the system.
 */

interface ParsedRow { studentCode: string; gradeLevel: string; classroom: string }
interface RowIssue { row: number; studentCode: string; errors: string[] }
interface PreviewRow {
  row: number; studentCode: string; name: string;
  gradeLevel: string; classroom: string; action: 'new' | 'update';
}
interface Report {
  totalRows: number; valid: number; invalid: number; year: number;
  committed?: number; issues: RowIssue[]; preview: PreviewRow[];
}

/** Split CSV/TSV text into {code, grade, room} rows, dropping a header line. */
function parseRows(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ParsedRow[] = [];
  lines.forEach((line, idx) => {
    const cells = line.split(/[,\t]/).map((c) => c.trim());
    if (idx === 0) {
      const low = line.toLowerCase();
      if (low.includes('รหัส') || low.includes('code') || low.includes('grade')) return; // header
    }
    const [studentCode = '', gradeLevel = '', classroom = ''] = cells;
    out.push({ studentCode, gradeLevel, classroom });
  });
  return out;
}

export function PlacementImportDialog({
  yearId, yearLabel, onClose, onDone,
}: {
  yearId: number;
  yearLabel: string | number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [renumber, setRenumber] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => parseRows(text), [text]);

  async function onFile(f: File | null) {
    if (!f) return;
    setText(await f.text());
    setReport(null);
  }

  async function send(dryRun: boolean) {
    if (!rows.length) return toast('ยังไม่มีข้อมูล — แนบไฟล์หรือวางข้อความ CSV', 'error');
    setBusy(true);
    try {
      const res = await api<Report>('/api/users/placements/import', jsonBody({ yearId, renumber, dryRun, rows }));
      setReport(res);
      if (!dryRun) {
        toast(`นำเข้าสำเร็จ จัดเข้าห้อง ${res.committed} คน`, 'success');
        onDone();
      }
    } catch (e) {
      const err = e as Error & { data?: { details?: Report } };
      if (err.data?.details) setReport(err.data.details);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const canCommit = report && report.invalid === 0 && report.valid > 0 && !report.committed;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="นำเข้า CSV จัดเข้าห้อง">
      <div className="modal" style={{ maxWidth: 640, width: '100%' }}>
        <div className="card-header">นำเข้า CSV — จัดนักเรียนเข้าห้อง (ปี {yearLabel})</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <p className="form-hint" style={{ margin: 0 }}>
            ไฟล์มี 3 คอลัมน์: <strong>รหัสนักเรียน, ชั้น, ห้อง</strong> (เช่น <span className="mono">10542,ม.1,2</span>) —
            นักเรียนต้องมีอยู่ในระบบแล้ว. บันทึกลงปี <strong>{yearLabel}</strong>.
          </p>

          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="file" accept=".csv,.txt" className="form-input" style={{ paddingTop: 8 }}
              onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            <span className="muted" style={{ fontSize: 13 }}>หรือวางข้อความด้านล่าง</span>
          </div>

          <textarea
            className="form-input mono"
            style={{ minHeight: 120, fontSize: 13 }}
            placeholder={'รหัสนักเรียน,ชั้น,ห้อง\n10542,ม.1,2\n10543,ม.1,3\n10544,ม.1,4'}
            value={text}
            onChange={(e) => { setText(e.target.value); setReport(null); }}
          />

          <div className="row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={renumber} onChange={(e) => setRenumber(e.target.checked)} />
              <span>รันเลขที่ใหม่ 1..N ในห้องที่จัด <span className="muted">(ไม่เลือก = ยังไม่มีเลขที่ ค่อยจัดที่หน้าจัดเลขที่)</span></span>
            </label>
            {rows.length > 0 && <span className="muted" style={{ fontSize: 13 }}>อ่านได้ {rows.length} แถว</span>}
          </div>

          {report && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="badge badge-purple">ทั้งหมด {report.totalRows}</span>
                <span className="badge badge-success">พร้อมจัด {report.valid}</span>
                <span className={`badge ${report.invalid ? 'badge-error' : 'badge-muted'}`}>ผิดพลาด {report.invalid}</span>
                {report.committed ? <span className="badge badge-success">บันทึกแล้ว {report.committed}</span> : null}
              </div>

              {report.issues.length > 0 && (
                <div style={{ maxHeight: 160, overflowY: 'auto' }} className="table-wrap">
                  <table className="table">
                    <thead><tr><th>แถว</th><th>รหัส</th><th>ปัญหา</th></tr></thead>
                    <tbody>
                      {report.issues.map((it, i) => (
                        <tr key={i}>
                          <td className="mono">{it.row}</td>
                          <td className="mono">{it.studentCode || '-'}</td>
                          <td style={{ color: 'var(--color-error)', fontSize: 13 }}>{it.errors.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {report.preview.length > 0 && !report.committed && (
                <div style={{ maxHeight: 200, overflowY: 'auto' }} className="table-wrap">
                  <table className="table">
                    <thead><tr><th>แถว</th><th>รหัส</th><th>ชื่อ</th><th>ชั้น/ห้อง</th><th></th></tr></thead>
                    <tbody>
                      {report.preview.map((p) => (
                        <tr key={p.row}>
                          <td className="mono">{p.row}</td>
                          <td className="mono">{p.studentCode}</td>
                          <td>{p.name}</td>
                          <td>{p.gradeLevel}/{p.classroom}</td>
                          <td>
                            <span className={`badge ${p.action === 'new' ? 'badge-purple' : 'badge-muted'}`}>
                              {p.action === 'new' ? 'เข้าห้องใหม่' : 'ย้าย/อัปเดต'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ปิด</button>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => send(true)} disabled={!rows.length || busy}>
                ตรวจสอบ
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => send(false)} disabled={!canCommit || busy}>
                {busy ? 'กำลังบันทึก…' : `ยืนยันนำเข้า${report ? ` ${report.valid} คน` : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

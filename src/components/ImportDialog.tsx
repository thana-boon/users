'use client';

import { useState } from 'react';
import { useToast } from './Toast';

interface Issue { row: number; studentCode?: string; teacherCode?: string; errors: string[] }
interface Report {
  totalRows: number; valid: number; invalid: number;
  committed?: number; created?: number; updated?: number; issues: Issue[];
}

/**
 * Two-step import: (1) validate (dryRun) and show a per-row error report,
 * (2) commit only when there are no errors. Matches spec: report bad rows
 * BEFORE committing to the DB.
 */
export function ImportDialog({
  kind,
  onClose,
  onDone,
}: {
  kind: 'students' | 'teachers';
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('dryRun', String(dryRun));
      const res = await fetch(`/api/users/${kind}/import`, { method: 'POST', body: fd });
      const data = (await res.json()) as Report & { error?: string; details?: Report };
      if (!res.ok) {
        setReport(data.details ?? { totalRows: 0, valid: 0, invalid: 0, issues: [] });
        toast(data.error ?? 'นำเข้าไม่สำเร็จ', 'error');
        return;
      }
      setReport(data);
      if (!dryRun) {
        toast(`นำเข้าสำเร็จ ${data.committed} รายการ (ใหม่ ${data.created}, อัปเดต ${data.updated})`, 'success');
        onDone();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const canCommit = report && report.invalid === 0 && report.valid > 0;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="นำเข้าข้อมูล">
      <div className="modal">
        <div className="card-header">นำเข้าข้อมูล{kind === 'students' ? 'นักเรียน' : 'ครู'} (.xlsx)</div>
        <div className="card-pad stack">
          <input
            type="file"
            accept=".xlsx"
            className="form-input"
            style={{ paddingTop: 8 }}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }}
          />
          <p className="form-hint">ระบบจะตรวจสอบก่อน (เลขบัตร 13 หลัก, รหัสซ้ำ) และแสดงแถวที่ผิดก่อนบันทึกจริง</p>

          {report && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-purple">ทั้งหมด {report.totalRows}</span>
                <span className="badge badge-success">ผ่าน {report.valid}</span>
                <span className={`badge ${report.invalid ? 'badge-error' : 'badge-muted'}`}>ผิดพลาด {report.invalid}</span>
              </div>
              {report.issues.length > 0 && (
                <div style={{ maxHeight: 220, overflowY: 'auto' }} className="table-wrap">
                  <table className="table">
                    <thead><tr><th>แถว</th><th>รหัส</th><th>ปัญหา</th></tr></thead>
                    <tbody>
                      {report.issues.map((it, i) => (
                        <tr key={i}>
                          <td className="mono">{it.row}</td>
                          <td className="mono">{it.studentCode ?? it.teacherCode ?? '-'}</td>
                          <td style={{ color: 'var(--color-error)', fontSize: 13 }}>{it.errors.join(', ')}</td>
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
              <button className="btn btn-secondary btn-sm" onClick={() => send(true)} disabled={!file || busy}>
                ตรวจสอบ
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => send(false)} disabled={!canCommit || busy}>
                ยืนยันนำเข้า
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

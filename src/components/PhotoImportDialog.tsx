'use client';

import { useState } from 'react';
import { useToast } from './Toast';

interface PhotoIssue { file: string; studentCode: string; reason: string }
interface Report {
  totalFiles: number; matched: number; skipped: number;
  committed?: number; issues: PhotoIssue[];
}

/**
 * Bulk student-photo import. Files are matched to students by filename: the
 * name minus its extension must equal the student code (e.g. 07822.jpg).
 * Two-step: preview (dryRun) then commit.
 */
export function PhotoImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<FileList | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f);
      fd.append('dryRun', String(dryRun));
      const res = await fetch('/api/users/students/photos', { method: 'POST', body: fd });
      const data = (await res.json()) as Report & { error?: string };
      if (!res.ok) { toast(data.error ?? 'นำเข้าไม่สำเร็จ', 'error'); return; }
      setReport(data);
      if (!dryRun) {
        toast(`อัปโหลดรูปสำเร็จ ${data.committed} รูป (ข้าม ${data.skipped})`, 'success');
        onDone();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const canCommit = report && report.matched > 0;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="นำเข้ารูปนักเรียน">
      <div className="modal">
        <div className="card-header">นำเข้ารูปนักเรียน</div>
        <div className="card-pad stack">
          <input
            type="file"
            accept="image/*"
            multiple
            className="form-input"
            style={{ paddingTop: 8 }}
            onChange={(e) => { setFiles(e.target.files); setReport(null); }}
          />
          <p className="form-hint">ตั้งชื่อไฟล์รูปให้ตรงกับ “รหัสประจำตัวนักเรียน” เช่น <b>07822.jpg</b> ระบบจะจับคู่ให้อัตโนมัติ (รองรับหลายไฟล์พร้อมกัน, สูงสุด 5MB/ไฟล์)</p>

          {report && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-purple">ทั้งหมด {report.totalFiles}</span>
                <span className="badge badge-success">จับคู่ได้ {report.matched}</span>
                <span className={`badge ${report.skipped ? 'badge-error' : 'badge-muted'}`}>ข้าม {report.skipped}</span>
              </div>
              {report.issues.length > 0 && (
                <div style={{ maxHeight: 220, overflowY: 'auto' }} className="table-wrap">
                  <table className="table">
                    <thead><tr><th>ไฟล์</th><th>รหัส</th><th>เหตุผล</th></tr></thead>
                    <tbody>
                      {report.issues.map((it, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 13 }}>{it.file}</td>
                          <td className="mono">{it.studentCode}</td>
                          <td style={{ color: 'var(--color-error)', fontSize: 13 }}>{it.reason}</td>
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
              <button className="btn btn-secondary btn-sm" onClick={() => send(true)} disabled={!files || busy}>ตรวจสอบ</button>
              <button className="btn btn-primary btn-sm" onClick={() => send(false)} disabled={!canCommit || busy}>ยืนยันอัปโหลด</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

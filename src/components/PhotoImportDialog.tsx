'use client';

import { useEffect, useState } from 'react';
import { withBase } from '@/lib/client';
import { cropToFace, preloadFaceDetector } from '@/lib/face-crop';
import { useToast } from './Toast';

interface PhotoIssue { file: string; reason: string; studentCode?: string; teacherCode?: string; workerCode?: string }
interface Report {
  totalFiles: number; matched: number; skipped: number;
  committed?: number; issues: PhotoIssue[];
}

/** A source file after auto-cropping, plus what the detector made of it. */
interface Prepared { file: File; faceFound: boolean; multipleFaces: boolean }

/** A file that could not be turned into a 480x640 frame, so is not uploaded. */
interface Broken { name: string; reason: string }

/** Read whichever *Code field the server returned on an issue row. */
function issueCode(it: PhotoIssue): string {
  return it.studentCode ?? it.teacherCode ?? it.workerCode ?? '-';
}

/**
 * Bulk profile-photo import. Files are matched by filename: the name minus its
 * extension must equal the person's code. Generic across นักเรียน/ครู/คนงาน via
 * the `endpoint` + label props (defaults to students so existing usage is
 * unchanged). Two-step: preview (dryRun) then commit.
 *
 * Every file is auto-cropped to its subject's face in the browser first (see
 * lib/face-crop). That happens during ตรวจสอบ and the result is reused for the
 * commit, so a few hundred photos are only decoded once. Photos where no face
 * was found still upload — they are centre-cropped and flagged in the preview,
 * since a wrong crop is easier to spot in the list than after the fact.
 */
export function PhotoImportDialog({
  onClose, onDone,
  endpoint = '/api/users/students/photos',
  title = 'นำเข้ารูปนักเรียน',
  hint = 'ตั้งชื่อไฟล์รูปให้ตรงกับ “รหัสประจำตัวนักเรียน” เช่น',
  codeExample = '07822.jpg',
}: {
  onClose: () => void;
  onDone: () => void;
  endpoint?: string;
  title?: string;
  hint?: string;
  codeExample?: string;
}) {
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [prepared, setPrepared] = useState<Prepared[] | null>(null);
  const [broken, setBroken] = useState<Broken[]>([]);
  const [cropDone, setCropDone] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  // The dialog only exists to import photos, so the model is certain to be
  // needed — fetch it while the user is still picking files.
  useEffect(() => { preloadFaceDetector(); }, []);

  /**
   * Crop every selected file, one at a time. Sequential on purpose: decoding a
   * few hundred multi-megabyte images at once is a good way to have the tab
   * killed. Cached so ยืนยันอัปโหลด doesn't redo the work.
   *
   * A file that can't be cropped is set aside rather than thrown — one corrupt
   * photo must not sink a 300-file import.
   */
  async function prepare(): Promise<Prepared[]> {
    if (prepared) return prepared;
    setCropDone(0);
    const out: Prepared[] = [];
    const bad: Broken[] = [];
    for (const f of files) {
      try {
        out.push(await cropToFace(f));
      } catch (e) {
        bad.push({ name: f.name, reason: (e as Error).message });
      }
      setCropDone(out.length + bad.length);
    }
    setPrepared(out);
    setBroken(bad);
    return out;
  }

  async function send(dryRun: boolean) {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const items = await prepare();
      if (items.length === 0) { toast('ไม่มีรูปที่ใช้ได้เลย', 'error'); return; }
      const fd = new FormData();
      for (const it of items) fd.append('files', it.file);
      fd.append('dryRun', String(dryRun));
      const res = await fetch(withBase(endpoint), { method: 'POST', body: fd });
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

  function pick(list: FileList | null) {
    setFiles(list ? Array.from(list) : []);
    setPrepared(null); // Different files: the cached crops no longer apply.
    setBroken([]);
    setReport(null);
  }

  const canCommit = report && report.matched > 0;
  const noFace = prepared?.filter((p) => !p.faceFound) ?? [];
  const manyFaces = prepared?.filter((p) => p.faceFound && p.multipleFaces) ?? [];
  const cropping = busy && prepared === null && files.length > 0;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <div className="card-header">{title}</div>
        <div className="card-pad stack">
          <input
            type="file"
            accept="image/*"
            multiple
            className="form-input"
            style={{ paddingTop: 8 }}
            onChange={(e) => pick(e.target.files)}
          />
          <p className="form-hint">{hint} <b>{codeExample}</b> ระบบจะจับคู่ให้อัตโนมัติ (รองรับหลายไฟล์พร้อมกัน)</p>
          <p className="form-hint">ระบบจะตรวจจับใบหน้าและครอบตัดรูปให้อัตโนมัติก่อนอัปโหลด รูปใหญ่แค่ไหนก็ได้ — จะถูกย่อเป็น 480×640 ให้เอง</p>

          {cropping && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="row-between" style={{ fontSize: 13 }}>
                <span>กำลังครอบตัดรูป…</span>
                <span className="mono">{cropDone}/{files.length}</span>
              </div>
              <progress value={cropDone} max={files.length} style={{ width: '100%' }} />
            </div>
          )}

          {broken.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="badge badge-error">ใช้ไม่ได้ {broken.length} ไฟล์ — ไม่ถูกอัปโหลด</span>
              <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 13 }} className="stack">
                {broken.map((b, i) => (
                  <span key={`${b.name}-${i}`}>
                    <span className="mono">{b.name}</span>
                    <span style={{ color: 'var(--color-error)' }}> — {b.reason}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {noFace.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="badge badge-warning">หาใบหน้าไม่พบ {noFace.length} รูป — ครอบตัดกลางภาพให้แทน</span>
              <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 13 }} className="stack">
                {noFace.map((p, i) => <span key={`${p.file.name}-${i}`} className="mono">{p.file.name}</span>)}
              </div>
            </div>
          )}

          {manyFaces.length > 0 && (
            <span className="badge badge-warning">
              พบหลายใบหน้า {manyFaces.length} รูป — เลือกใบหน้าที่ใหญ่ที่สุดให้ ควรตรวจสอบอีกครั้ง
            </span>
          )}

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
                          <td className="mono">{issueCode(it)}</td>
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
              <button className="btn btn-secondary btn-sm" onClick={() => send(true)} disabled={files.length === 0 || busy}>ตรวจสอบ</button>
              <button className="btn btn-primary btn-sm" onClick={() => send(false)} disabled={!canCommit || busy}>ยืนยันอัปโหลด</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

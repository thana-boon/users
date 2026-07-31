'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { withBase } from '@/lib/client';
import { cropToFace, preloadFaceDetector } from '@/lib/face-crop';
import { useToast } from './Toast';

interface PhotoIssue { file: string; reason: string; studentCode?: string; teacherCode?: string; workerCode?: string }

/** Result of the name-only precheck (JSON round trip, no image bytes). */
interface CheckReport {
  totalFiles: number;
  matched: number;
  skipped: number;
  issues: PhotoIssue[];
  /** Filenames that resolved to a real person — the only ones worth uploading. */
  matchedNames: string[];
}

/** Everything the running import has learned so far. Rendered live. */
interface RunState {
  cropped: number;
  total: number;
  committed: number;
  failed: string[];
  broken: { name: string; reason: string }[];
  noFace: string[];
  multiFace: number;
  issues: PhotoIssue[];
  error: string | null;
}

/**
 * How much goes up in one request. Deliberately under nginx's *default*
 * `client_max_body_size` of 1MB: the SchoolOS gateway sits in front of this
 * module, and a 4000-photo import must not depend on someone having raised that
 * limit. Raise BATCH_MAX_BYTES if the gateway is known to allow more — fewer,
 * larger requests are slightly faster, but cropping dominates the wall clock
 * anyway, so the safe default costs almost nothing.
 *
 * Smaller batches also mean a failed one costs seconds of redone work rather
 * than the whole import, and each stays far inside the route's 60s maxDuration.
 * At ~50KB per cropped photo the byte ceiling trips first (~16 files).
 */
const BATCH_MAX_FILES = 40;
const BATCH_MAX_BYTES = 800 * 1024;

/** Read whichever *Code field the server returned on an issue row. */
function issueCode(it: PhotoIssue): string {
  return it.studentCode ?? it.teacherCode ?? it.workerCode ?? '-';
}

function newRun(total: number): RunState {
  return { cropped: 0, total, committed: 0, failed: [], broken: [], noFace: [], multiFace: 0, issues: [], error: null };
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 90) return `${Math.ceil(seconds)} วินาที`;
  const min = Math.ceil(seconds / 60);
  if (min < 60) return `${min} นาที`;
  return `${Math.floor(min / 60)} ชม. ${min % 60} นาที`;
}

/**
 * Bulk profile-photo import. Files are matched by filename: the name minus its
 * extension must equal the person's code. Generic across นักเรียน/ครู/คนงาน via
 * the `endpoint` + label props (defaults to students so existing usage is
 * unchanged).
 *
 * Built for the real job — "here are 4000 files, sort them out" — in two steps:
 *
 * 1. ตรวจสอบ posts only the FILENAMES as JSON. The server answers which codes
 *    exist, so 2000 files belonging to nobody are found in under a second
 *    instead of after a 200MB upload. Nothing is decoded or transmitted yet.
 *
 * 2. ยืนยันอัปโหลด then walks the matches: crop one photo (browser-side, see
 *    lib/face-crop), add it to a batch, and POST each batch of a few MB while
 *    the next one is being cropped. Memory stays flat, progress is live, and a
 *    dropped connection costs one batch — retryable from the summary — rather
 *    than the whole run.
 *
 * Face warnings (no face found / several faces) surface DURING the upload
 * rather than before it, because cropping is now the expensive step and doing
 * it twice for a 4000-file import would cost half an hour.
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
  const [check, setCheck] = useState<CheckReport | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [phase, setPhase] = useState<'idle' | 'checking' | 'uploading' | 'done'>('idle');
  const [eta, setEta] = useState<number>(NaN);

  // Read inside the loop, so it must not be state — a re-render is not needed
  // for the cancel to take effect on the next file.
  const cancelled = useRef(false);

  // The dialog only exists to import photos, so the model is certain to be
  // needed — fetch it while the user is still picking files.
  useEffect(() => { preloadFaceDetector(); }, []);

  // A 4000-photo run takes many minutes; closing the tab mid-way would lose the
  // rest of it (what was already committed stays committed).
  useEffect(() => {
    if (phase !== 'uploading') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  function pick(list: FileList | null) {
    setFiles(list ? Array.from(list) : []);
    setCheck(null);
    setRun(null);
    setPhase('idle');
  }

  /** Step 1 — filenames only. Cheap enough to run on the whole selection. */
  async function runCheck() {
    if (files.length === 0) return;
    setPhase('checking');
    setRun(null);
    try {
      const res = await fetch(withBase(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: files.map((f) => f.name) }),
      });
      const data = (await res.json()) as CheckReport & { error?: string };
      if (!res.ok) { toast(data.error ?? 'ตรวจสอบไม่สำเร็จ', 'error'); return; }
      setCheck(data);
      if (data.matched === 0) toast('ไม่มีไฟล์ที่ตรงกับรหัสในระบบเลย', 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPhase('idle');
    }
  }

  /** POST one batch. Never throws: a failed batch is recorded and the run goes on. */
  async function sendBatch(cropped: File[], sources: File[], state: RunState) {
    const fd = new FormData();
    for (const f of cropped) fd.append('files', f);
    fd.append('dryRun', 'false');
    try {
      const res = await fetch(withBase(endpoint), { method: 'POST', body: fd });
      const data = (await res.json()) as { committed: number; issues: PhotoIssue[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `อัปโหลดไม่สำเร็จ (${res.status})`);
      state.committed += data.committed;
      state.issues.push(...(data.issues ?? []));
    } catch (e) {
      state.failed.push(...sources.map((f) => f.name));
      state.error = (e as Error).message;
    }
    setRun({ ...state });
  }

  /**
   * Step 2 — crop and upload `targets`, batch by batch. One upload is kept in
   * flight while the next batch is cropped: the network wait and the CPU work
   * overlap instead of taking turns.
   */
  async function runUpload(targets: File[]) {
    if (targets.length === 0) return;
    cancelled.current = false;
    const state = newRun(targets.length);
    setRun({ ...state });
    setPhase('uploading');
    const startedAt = Date.now();

    let batch: File[] = [];
    let sources: File[] = [];
    let bytes = 0;
    let inflight: Promise<void> | null = null;

    try {
      for (const file of targets) {
        if (cancelled.current) break;
        try {
          const r = await cropToFace(file);
          if (!r.faceFound) state.noFace.push(file.name);
          if (r.multipleFaces) state.multiFace++;
          batch.push(r.file);
          sources.push(file);
          bytes += r.file.size;
        } catch (e) {
          // One corrupt photo must not sink a 4000-file import.
          state.broken.push({ name: file.name, reason: (e as Error).message });
        }
        state.cropped++;
        setRun({ ...state });

        const elapsed = (Date.now() - startedAt) / 1000;
        setEta((elapsed / state.cropped) * (state.total - state.cropped));

        if (batch.length >= BATCH_MAX_FILES || bytes >= BATCH_MAX_BYTES) {
          await inflight; // at most one request in flight — keeps memory flat
          inflight = sendBatch(batch, sources, state);
          batch = []; sources = []; bytes = 0;
        }
      }

      await inflight;
      if (batch.length > 0) await sendBatch(batch, sources, state);

      setPhase('done');
      setRun({ ...state });
      if (state.committed > 0) {
        onDone();
        toast(
          cancelled.current
            ? `หยุดแล้ว — อัปโหลดไปได้ ${state.committed} รูป`
            : `อัปโหลดรูปสำเร็จ ${state.committed} รูป`,
          cancelled.current ? 'info' : 'success',
        );
      } else {
        toast('ไม่มีรูปที่อัปโหลดสำเร็จ', 'error');
      }
    } catch (e) {
      state.error = (e as Error).message;
      setRun({ ...state });
      setPhase('done');
      toast(state.error, 'error');
    }
  }

  const busy = phase === 'checking' || phase === 'uploading';

  // Set membership, not Array.includes: this runs on every render of a run that
  // may hold 4000 names on each side.
  const matchedFiles = useMemo(() => {
    if (!check) return [];
    const keep = new Set(check.matchedNames);
    return files.filter((f) => keep.has(f.name));
  }, [check, files]);
  const retryFiles = useMemo(() => {
    if (!run || run.failed.length === 0) return [];
    const again = new Set(run.failed);
    return files.filter((f) => again.has(f.name));
  }, [run, files]);
  const pct = run && run.total > 0 ? Math.round((run.cropped / run.total) * 100) : 0;
  const allIssues = [...(check?.issues ?? []), ...(run?.issues ?? [])];

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
            disabled={busy}
            onChange={(e) => pick(e.target.files)}
          />
          <p className="form-hint">{hint} <b>{codeExample}</b> ระบบจะจับคู่ให้อัตโนมัติ — เลือกทีเดียวทั้งโฟลเดอร์ได้เลย ไฟล์ที่ไม่ตรงรหัสระบบจะข้ามให้เอง</p>
          <p className="form-hint">กด <b>ตรวจสอบ</b> ก่อน (เร็ว ไม่ต้องอัปโหลดรูป) แล้วค่อยกดยืนยัน ระบบจะครอบตัดใบหน้าและทยอยส่งทีละชุดพร้อมแสดงความคืบหน้า</p>

          {files.length > 0 && phase === 'idle' && !check && (
            <span className="badge badge-muted">เลือกไว้ {files.length.toLocaleString()} ไฟล์</span>
          )}

          {phase === 'checking' && <span className="badge badge-muted">กำลังตรวจสอบรายชื่อไฟล์…</span>}

          {check && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-purple">ทั้งหมด {check.totalFiles.toLocaleString()}</span>
              <span className="badge badge-success">จับคู่ได้ {check.matched.toLocaleString()}</span>
              <span className={`badge ${check.skipped ? 'badge-error' : 'badge-muted'}`}>ข้าม {check.skipped.toLocaleString()}</span>
            </div>
          )}

          {run && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row-between" style={{ fontSize: 13 }}>
                <span>
                  {phase === 'uploading' ? 'กำลังครอบตัดและอัปโหลด…' : 'สรุปผลการอัปโหลด'}
                  {phase === 'uploading' && <> · เหลืออีกประมาณ {formatEta(eta)}</>}
                </span>
                <span className="mono">{run.cropped.toLocaleString()}/{run.total.toLocaleString()} ({pct}%)</span>
              </div>
              <progress value={run.cropped} max={run.total} style={{ width: '100%' }} />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="badge badge-success">บันทึกแล้ว {run.committed.toLocaleString()}</span>
                {run.broken.length > 0 && <span className="badge badge-error">ไฟล์เสีย {run.broken.length}</span>}
                {run.failed.length > 0 && <span className="badge badge-error">ส่งไม่สำเร็จ {run.failed.length}</span>}
                {run.noFace.length > 0 && <span className="badge badge-warning">หาใบหน้าไม่พบ {run.noFace.length} — ครอบตัดกลางภาพแทน</span>}
                {run.multiFace > 0 && <span className="badge badge-warning">พบหลายใบหน้า {run.multiFace} — เลือกใบหน้าที่ใหญ่สุด</span>}
              </div>
              {run.error && <span style={{ color: 'var(--color-error)', fontSize: 13 }}>{run.error}</span>}
            </div>
          )}

          {run && run.broken.length > 0 && (
            <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 13 }} className="stack">
              {run.broken.map((b, i) => (
                <span key={`${b.name}-${i}`}>
                  <span className="mono">{b.name}</span>
                  <span style={{ color: 'var(--color-error)' }}> — {b.reason}</span>
                </span>
              ))}
            </div>
          )}

          {allIssues.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto' }} className="table-wrap">
              <table className="table">
                <thead><tr><th>ไฟล์</th><th>รหัส</th><th>เหตุผล</th></tr></thead>
                <tbody>
                  {allIssues.slice(0, 500).map((it, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 13 }}>{it.file}</td>
                      <td className="mono">{issueCode(it)}</td>
                      <td style={{ color: 'var(--color-error)', fontSize: 13 }}>{it.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allIssues.length > 500 && (
                <p className="form-hint">แสดง 500 รายการแรกจากทั้งหมด {allIssues.length.toLocaleString()} รายการ</p>
              )}
            </div>
          )}

          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={phase === 'uploading'}>ปิด</button>
            <div className="row" style={{ gap: 8 }}>
              {phase === 'uploading' && (
                <button className="btn btn-secondary btn-sm" onClick={() => { cancelled.current = true; }}>
                  หยุด
                </button>
              )}
              {phase === 'done' && retryFiles.length > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => runUpload(retryFiles)}>
                  ลองใหม่เฉพาะที่ล้มเหลว ({retryFiles.length})
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={runCheck} disabled={files.length === 0 || busy}>
                ตรวจสอบ
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => runUpload(matchedFiles)}
                disabled={busy || matchedFiles.length === 0}
              >
                ยืนยันอัปโหลด{matchedFiles.length > 0 ? ` (${matchedFiles.length.toLocaleString()})` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

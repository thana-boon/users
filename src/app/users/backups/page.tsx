'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, withBase } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { IconDatabase, IconDownload, IconUpload, IconRestore, IconTrash } from '@/components/Icons';

/**
 * สำรอง/กู้คืนข้อมูล — the backup console.
 *
 * Everything on this page acts on ONE thing: a pg_dump of the whole module
 * database (records, enrollments, audit trail, and the photos, which live inline
 * in the tables). The server does the work; this page's job is to make the state
 * of the backup system legible at a glance and to make restore hard to do by
 * accident. See src/lib/backup.ts.
 */

type BackupKind = 'auto' | 'manual' | 'upload' | 'prerestore';

interface BackupFile {
  name: string;
  kind: BackupKind;
  createdAt: string;
  bytes: number;
  actor: string | null;
  note: string | null;
}

interface Overview {
  data: BackupFile[];
  dir: string;
  writable: boolean;
  hint: string | null;
  toolsAvailable: boolean;
  database: string;
  retention: { auto: number; manual: number; prerestore: number };
  schedule: { enabled: boolean; time: string; tz: string; nextRunAt: string | null };
  lastRun: { lastRunAt: string | null; ok: boolean | null; file: string | null; error: string | null };
  busy: { what: string; since: string } | null;
}

const KIND_BADGE: Record<BackupKind, { cls: string; label: string }> = {
  auto: { cls: 'badge-purple', label: 'อัตโนมัติ' },
  manual: { cls: 'badge-navy', label: 'สำรองเอง' },
  upload: { cls: 'badge-gold', label: 'อัปโหลด' },
  prerestore: { cls: 'badge-warning', label: 'ก่อนกู้คืน' },
};

/** Typed by hand before a restore runs. Deliberately not a single "OK" click. */
const RESTORE_PHRASE = 'กู้คืนข้อมูล';

function thaiDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function BackupsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setOv(await api<Overview>('/api/users/backups'));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function backupNow() {
    setWorking('กำลังสำรองข้อมูล…');
    try {
      const res = await api<{ file: BackupFile; pruned: string[] }>('/api/users/backups', { method: 'POST' });
      toast(
        `สำรองข้อมูลสำเร็จ · ${fileSize(res.file.bytes)}` +
          (res.pruned.length ? ` (ลบไฟล์เก่า ${res.pruned.length} ไฟล์)` : ''),
        'success',
      );
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setWorking(null);
    }
  }

  async function upload(file: File) {
    setWorking(`กำลังอัปโหลด ${file.name}…`);
    try {
      // Raw body, not FormData: the server streams it straight to disk, so a
      // multi-gigabyte dump never has to sit in anyone's memory.
      const res = await fetch(
        withBase(`/api/users/backups/upload?name=${encodeURIComponent(file.name)}`),
        { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'อัปโหลดไม่สำเร็จ');
      toast('อัปโหลดไฟล์สำรองสำเร็จ — ตรวจสอบไฟล์แล้วว่ากู้คืนได้', 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setWorking(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(b: BackupFile) {
    const okToGo = await confirm({
      title: 'ลบไฟล์สำรอง',
      message: `ลบไฟล์ ${b.name}?\n\nไฟล์นี้จะหายจากเซิร์ฟเวอร์ถาวร กู้กลับมาไม่ได้`,
      confirmText: 'ลบไฟล์',
      danger: true,
    });
    if (!okToGo) return;
    try {
      await api(`/api/users/backups/${encodeURIComponent(b.name)}`, { method: 'DELETE' });
      toast('ลบไฟล์สำรองแล้ว', 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const busy = working !== null;
  const blocked = ov ? !ov.writable || !ov.toolsAvailable : false;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">สำรอง/กู้คืนข้อมูล</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            สำรองฐานข้อมูลทั้งระบบ — ข้อมูลนักเรียน ครู คนงาน ปีการศึกษา รูปภาพ
            และบันทึกการใช้งาน อยู่ในไฟล์เดียว
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            ref={fileInput}
            type="file"
            accept=".dump"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => fileInput.current?.click()}
            disabled={busy || blocked}
          >
            <IconUpload width={16} height={16} /> อัปโหลดไฟล์สำรอง
          </button>
          <button className="btn btn-primary btn-sm" onClick={backupNow} disabled={busy || blocked}>
            <IconDatabase width={16} height={16} /> {busy ? 'กำลังทำงาน…' : 'สำรองข้อมูลทันที'}
          </button>
        </div>
      </div>

      {ov && !ov.toolsAvailable && (
        <div className="alert alert-error" style={{ fontSize: 13 }}>
          <strong>ยังสำรองข้อมูลไม่ได้</strong> — ไม่พบคำสั่ง <code className="mono">pg_dump</code> ในเซิร์ฟเวอร์
          ต้อง build image ใหม่ (<code className="mono">docker compose up -d --build</code>)
          เพราะ Dockerfile เป็นตัวติดตั้ง <code className="mono">postgresql16-client</code> ให้
        </div>
      )}
      {ov && ov.toolsAvailable && !ov.writable && (
        <div className="alert alert-error" style={{ fontSize: 13 }}>
          <strong>ยังสำรองข้อมูลไม่ได้</strong> — {ov.hint}
        </div>
      )}
      {ov?.lastRun.ok === false && (
        <div className="alert alert-error" style={{ fontSize: 13 }}>
          <strong>การสำรองอัตโนมัติครั้งล่าสุดล้มเหลว</strong> ({thaiDateTime(ov.lastRun.lastRunAt)})
          <div className="mono" style={{ marginTop: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {ov.lastRun.error}
          </div>
        </div>
      )}
      {busy && (
        <div className="alert alert-info" style={{ fontSize: 13 }}>
          {working} — อย่าปิดหน้านี้จนกว่าจะเสร็จ
        </div>
      )}

      <div className="grid-3">
        <div className="stat">
          <span className="stat-label">สำรองล่าสุด</span>
          <span className="stat-value" style={{ fontSize: 18 }}>
            {ov?.data.length ? thaiDateTime(ov.data[0].createdAt) : '-'}
          </span>
          <span className="stat-sub">
            {ov?.data.length ? `${ov.data.length} ไฟล์บนเซิร์ฟเวอร์` : 'ยังไม่มีไฟล์สำรอง'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">สำรองอัตโนมัติครั้งถัดไป</span>
          <span className="stat-value" style={{ fontSize: 18 }}>
            {ov?.schedule.enabled ? thaiDateTime(ov.schedule.nextRunAt) : 'ปิดอยู่'}
          </span>
          <span className="stat-sub">
            {ov?.schedule.enabled
              ? `ทุกวันเวลา ${ov.schedule.time} น. (${ov.schedule.tz})`
              : 'ตั้งค่า BACKUP_SCHEDULE=on เพื่อเปิด'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">เก็บย้อนหลัง</span>
          <span className="stat-value" style={{ fontSize: 18 }}>
            {ov ? `${ov.retention.auto} วัน` : '-'}
          </span>
          <span className="stat-sub">ครบแล้วระบบลบไฟล์เก่าสุดให้อัตโนมัติ</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>วันที่–เวลา</th><th>ประเภท</th><th>ขนาด</th>
                <th>ผู้ทำรายการ</th><th>ชื่อไฟล์</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 20 }} /></td></tr>
              ))}
              {!loading && !ov?.data.length && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                    ยังไม่มีไฟล์สำรอง — กด “สำรองข้อมูลทันที” เพื่อเริ่มไฟล์แรก
                  </td>
                </tr>
              )}
              {ov?.data.map((b) => (
                <tr key={b.name}>
                  <td style={{ whiteSpace: 'nowrap' }}>{thaiDateTime(b.createdAt)}</td>
                  <td><span className={`badge ${KIND_BADGE[b.kind].cls}`}>{KIND_BADGE[b.kind].label}</span></td>
                  <td className="num">{fileSize(b.bytes)}</td>
                  <td style={{ fontSize: 13 }}>
                    {b.actor ?? <span className="muted">ระบบ</span>}
                    {b.note && <div className="muted" style={{ fontSize: 11 }}>{b.note}</div>}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{b.name}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <a
                        className="chip"
                        href={withBase(`/api/users/backups/${encodeURIComponent(b.name)}`)}
                        download={b.name}
                      >
                        <IconDownload width={13} height={13} /> ดาวน์โหลด
                      </a>
                      <button className="chip" onClick={() => setRestoring(b)} disabled={busy}>
                        <IconRestore width={13} height={13} /> กู้คืน
                      </button>
                      <button className="chip" onClick={() => remove(b)} disabled={busy}>
                        <IconTrash width={13} height={13} /> ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Guide overview={ov} />

      {restoring && (
        <RestoreDialog
          file={restoring}
          database={ov?.database ?? '-'}
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  );
}

/**
 * The restore confirmation.
 *
 * Restoring replaces every table in the database, so this is the one dialog in
 * the module that refuses a single click: the operator has to type the phrase,
 * and is told plainly what will be lost (everything entered since the backup)
 * and what protects them (the automatic copy of the current data).
 */
function RestoreDialog({
  file,
  database,
  onClose,
}: {
  file: BackupFile;
  database: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ safetyBackup: string | null } | null>(null);

  async function go() {
    setRunning(true);
    try {
      const res = await api<{ safetyBackup: string | null }>(
        `/api/users/backups/${encodeURIComponent(file.name)}/restore`,
        { method: 'POST' },
      );
      setDone(res);
    } catch (e) {
      toast((e as Error).message, 'error');
      setRunning(false);
    }
  }

  if (done) {
    return (
      <div className="modal-scrim" role="dialog" aria-modal="true">
        <div className="modal" style={{ maxWidth: 460 }}>
          <div className="card-header">กู้คืนข้อมูลสำเร็จ</div>
          <div className="card-pad stack" style={{ gap: 16 }}>
            <div className="alert alert-success" style={{ fontSize: 13 }}>
              ฐานข้อมูลถูกแทนที่ด้วยข้อมูลจากไฟล์ <span className="mono">{file.name}</span> เรียบร้อยแล้ว
            </div>
            {done.safetyBackup && (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                ข้อมูลชุดเดิม (ก่อนกู้คืน) ถูกสำรองไว้ให้แล้วที่{' '}
                <span className="mono" style={{ fontSize: 11 }}>{done.safetyBackup}</span> — ถ้ากู้ผิดไฟล์
                ให้กู้คืนจากไฟล์นั้นเพื่อย้อนกลับ
              </div>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={() => window.location.reload()}
            >
              โหลดหน้าใหม่
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="restore-title">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="card-header" id="restore-title">กู้คืนข้อมูลทั้งระบบ</div>
        <div className="card-pad stack" style={{ gap: 16 }}>
          <div className="alert alert-error" style={{ fontSize: 13, lineHeight: 1.6 }}>
            <strong>ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่</strong> ด้วยข้อมูลจากไฟล์นี้ —
            ทุกอย่างที่เพิ่มหรือแก้ไขหลังจาก{' '}
            <strong>{thaiDateTime(file.createdAt)}</strong> จะหายไป
          </div>

          <div className="stack" style={{ gap: 6, fontSize: 13 }}>
            <div className="row-between"><span className="muted">ไฟล์</span><span className="mono" style={{ fontSize: 11 }}>{file.name}</span></div>
            <div className="row-between"><span className="muted">ข้อมูล ณ วันที่</span><span>{thaiDateTime(file.createdAt)}</span></div>
            <div className="row-between"><span className="muted">ขนาด</span><span>{fileSize(file.bytes)}</span></div>
            <div className="row-between"><span className="muted">ฐานข้อมูลปลายทาง</span><span className="mono" style={{ fontSize: 11 }}>{database}</span></div>
          </div>

          <div className="alert alert-info" style={{ fontSize: 12, lineHeight: 1.6 }}>
            ระบบจะ<strong>สำรองข้อมูลชุดปัจจุบันไว้ให้อัตโนมัติ</strong>ก่อนเริ่มกู้คืน
            ถ้ากู้ผิดไฟล์ยังย้อนกลับได้ และถ้ากู้คืนไม่สำเร็จกลางคัน ฐานข้อมูลจะกลับไปเป็นเหมือนเดิมทั้งหมด
          </div>

          <div>
            <label className="form-label" htmlFor="restore-confirm">
              พิมพ์ “{RESTORE_PHRASE}” เพื่อยืนยัน
            </label>
            <input
              id="restore-confirm"
              className="form-input"
              style={{ width: '100%' }}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={running}
              autoComplete="off"
              autoFocus
            />
          </div>

          {running && (
            <div className="alert alert-warning" style={{ fontSize: 13 }}>
              กำลังกู้คืน… อาจใช้เวลาหลายนาที <strong>อย่าปิดหน้านี้</strong>
            </div>
          )}

          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={running}>
              ยกเลิก
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={go}
              disabled={running || typed.trim() !== RESTORE_PHRASE}
            >
              {running ? 'กำลังกู้คืน…' : 'กู้คืนข้อมูล'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** How the backups work, on the page — so nobody has to find the README at 22:00. */
function Guide({ overview }: { overview: Overview | null }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <IconDatabase width={18} height={18} />
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>ระบบสำรองข้อมูลทำงานอย่างไร</h2>
      </div>
      <div className="stack" style={{ gap: 12, fontSize: 13, lineHeight: 1.7 }}>
        <div>
          <strong>สำรองอัตโนมัติ</strong> — ทุกคืนเวลา{' '}
          {overview?.schedule.time ?? '00:00'} น. ระบบสำรองฐานข้อมูลทั้งหมดเก็บไว้บนเซิร์ฟเวอร์
          เก็บย้อนหลัง {overview?.retention.auto ?? 14} ไฟล์ — พอครบระบบจะลบไฟล์เก่าที่สุดทิ้งเอง
          ไฟล์ที่<strong>อัปโหลดเข้ามา</strong>จะไม่ถูกลบอัตโนมัติ ต้องกดลบเอง
        </div>
        <div>
          <strong>ไฟล์เก็บไว้ที่ไหน</strong> —{' '}
          <code className="mono">{overview?.dir ?? '/app/backups'}</code> ในคอนเทนเนอร์
          ซึ่งผูกกับโฟลเดอร์จริงบนเครื่อง server (ดู <code className="mono">docker-compose.yml</code>)
          ไฟล์จึงอยู่ต่อแม้จะลบคอนเทนเนอร์ทิ้ง และ copy ออกไปเก็บที่ NAS หรือ USB ได้เลย
        </div>
        <div>
          <strong>ข้อมูลอะไรอยู่ในไฟล์บ้าง</strong> — ทั้งฐานข้อมูล{' '}
          <code className="mono">{overview?.database ?? '-'}</code> รวมรูปภาพนักเรียน–ครู
          (เก็บอยู่ในตารางโดยตรง) และบันทึกการใช้งานทั้งหมด
        </div>
        <div className="alert alert-warning" style={{ fontSize: 12 }}>
          <strong>ไฟล์สำรองมีข้อมูลส่วนบุคคลครบทุกอย่าง</strong> ทั้งเลขบัตรประชาชนและรหัสผ่าน
          (เข้ารหัสไว้ด้วย <code className="mono">FIELD_ENCRYPTION_KEY</code>)
          — ถ้าดาวน์โหลดออกไปเก็บเอง ต้องเก็บให้ปลอดภัยเท่ากับตัวระบบ
          และการดาวน์โหลดทุกครั้งถูกบันทึกไว้ในบันทึกการใช้งาน
          <div style={{ marginTop: 6 }}>
            หมายเหตุ: การกู้คืนต้องใช้ <code className="mono">FIELD_ENCRYPTION_KEY</code> ตัวเดิม
            มิฉะนั้นเลขบัตร/รหัสผ่านในไฟล์จะถอดรหัสไม่ได้ — เก็บ key ไว้แยกจากไฟล์สำรองเสมอ
          </div>
        </div>
      </div>
    </div>
  );
}

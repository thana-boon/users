'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconSearch, IconPlus, IconImage } from '@/components/Icons';
import { PhotoImportDialog } from '@/components/PhotoImportDialog';
import { PhotoThumb, PhotoLightbox } from '@/components/PhotoThumb';

interface Row {
  id: number; workerCode: string; prefix: string | null;
  firstName: string; lastName: string; position: string | null;
  phone: string | null; employmentStatus: 'active' | 'resigned';
  hasPhoto: boolean;
}

export default function WorkersPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [zoom, setZoom] = useState<Row | null>(null);
  const pageSize = 25;
  const deb = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (q) sp.set('q', q);
      if (status) sp.set('status', status);
      const res = await api<{ data: Row[]; total: number }>(`/api/users/workers?${sp}`);
      setRows(res.data); setTotal(res.total); setPage(p);
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [q, status, toast]);

  useEffect(() => {
    clearTimeout(deb.current);
    deb.current = setTimeout(() => load(1), 300);
    return () => clearTimeout(deb.current);
  }, [q, status, load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <h1 className="page-title">คนงาน</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPhotos(true)}><IconImage width={16} height={16} /> นำเข้ารูป</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><IconPlus width={16} height={16} /> เพิ่ม</button>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--skdw-muted)' }}><IconSearch width={18} height={18} /></span>
            <input className="form-input" style={{ paddingLeft: 38 }} placeholder="ค้นหารหัส / ชื่อ / ตำแหน่ง" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาคนงาน" />
          </div>
          <select className="form-select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะ">
            <option value="">ทุกสถานะ</option>
            <option value="active">ทำงานอยู่</option>
            <option value="resigned">ลาออกแล้ว</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 48 }}>รูป</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>เบอร์โทร</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>
              {loading && rows.length === 0 && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}><td colSpan={7}><div className="skeleton" style={{ height: 20 }} /></td></tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 40 }}>ไม่พบคนงานที่ค้นหา</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ paddingTop: 6, paddingBottom: 6 }}>
                    <PhotoThumb
                      src={r.hasPhoto ? `/api/users/workers/${r.id}/photo` : null}
                      initials={(r.firstName[0] ?? '') + (r.lastName[0] ?? '')}
                      alt={`${r.firstName} ${r.lastName}`}
                      onClick={() => setZoom(r)}
                    />
                  </td>
                  <td className="mono">{r.workerCode}</td>
                  <td>{r.prefix ?? ''}{r.firstName} {r.lastName}</td>
                  <td style={{ fontSize: 13 }}>{r.position ?? '-'}</td>
                  <td className="mono" style={{ fontSize: 13 }}>{r.phone ?? '-'}</td>
                  <td>
                    <span className={`badge ${r.employmentStatus === 'resigned' ? 'badge-muted' : 'badge-success'}`}>
                      {r.employmentStatus === 'resigned' ? 'ลาออกแล้ว' : 'ทำงานอยู่'}
                    </span>
                  </td>
                  <td><Link href={`/users/workers/${r.id}`} className="chip">ดู/แก้ไข</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-between" style={{ padding: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>ทั้งหมด {total.toLocaleString('th-TH')} คน</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>ก่อนหน้า</button>
            <span className="mono" style={{ fontSize: 13 }}>{page} / {pages}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pages || loading} onClick={() => load(page + 1)}>ถัดไป</button>
          </div>
        </div>
      </div>

      {showPhotos && (
        <PhotoImportDialog
          endpoint="/api/users/workers/photos"
          title="นำเข้ารูปคนงาน"
          hint="ตั้งชื่อไฟล์รูปให้ตรงกับ “รหัสคนงาน” เช่น"
          codeExample="W005.jpg"
          onClose={() => setShowPhotos(false)}
          onDone={() => { setShowPhotos(false); load(page); }}
        />
      )}
      {showNew && <NewWorker onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(1); toast('เพิ่มคนงานแล้ว', 'success'); }} />}
      {zoom && (
        <PhotoLightbox
          src={`/api/users/workers/${zoom.id}/photo`}
          alt={`${zoom.firstName} ${zoom.lastName}`}
          caption={`${zoom.workerCode} · ${zoom.prefix ?? ''}${zoom.firstName} ${zoom.lastName}`}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

function NewWorker({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    workerCode: '', prefix: 'นาย', firstName: '', lastName: '',
    position: '', phone: '', citizenId: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    if (!f.workerCode || !f.firstName || !f.lastName) { toast('กรุณากรอกรหัส/ชื่อ/นามสกุล', 'error'); return; }
    setBusy(true);
    try { await api('/api/users/workers', jsonBody(f)); onCreated(); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="เพิ่มคนงาน">
      <div className="modal">
        <div className="card-header">เพิ่มคนงาน</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div className="grid-2">
            <div><label className="form-label required">รหัสคนงาน</label><input className="form-input" value={f.workerCode} onChange={set('workerCode')} placeholder="W005" /></div>
            <div><label className="form-label">คำนำหน้า</label><input className="form-input" value={f.prefix} onChange={set('prefix')} /></div>
          </div>
          <div className="grid-2">
            <div><label className="form-label required">ชื่อ</label><input className="form-input" value={f.firstName} onChange={set('firstName')} /></div>
            <div><label className="form-label required">นามสกุล</label><input className="form-input" value={f.lastName} onChange={set('lastName')} /></div>
          </div>
          <div className="grid-2">
            <div><label className="form-label">ตำแหน่ง/หน้าที่</label><input className="form-input" value={f.position} onChange={set('position')} placeholder="เช่น นักการภารโรง" /></div>
            <div><label className="form-label">เบอร์โทร</label><input className="form-input" value={f.phone} onChange={set('phone')} /></div>
          </div>
          <div><label className="form-label">เลขบัตรประชาชน</label><input className="form-input mono" value={f.citizenId} onChange={set('citizenId')} placeholder="เลข 13 หลัก" /></div>
        </div>
        <div className="row-between card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconSearch, IconPlus, IconDownload, IconUpload } from '@/components/Icons';
import { ImportDialog } from '@/components/ImportDialog';

interface Row {
  id: number; teacherCode: string; prefix: string | null;
  firstName: string; lastName: string; email: string | null;
  subjectGroup: string | null; gradeTaught: string | null; role: string;
}

export default function TeachersPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const pageSize = 25;
  const deb = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (q) sp.set('q', q);
      if (role) sp.set('role', role);
      const res = await api<{ data: Row[]; total: number }>(`/api/users/teachers?${sp}`);
      setRows(res.data); setTotal(res.total); setPage(p);
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [q, role, toast]);

  useEffect(() => {
    clearTimeout(deb.current);
    deb.current = setTimeout(() => load(1), 300);
    return () => clearTimeout(deb.current);
  }, [q, role, load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <h1 className="page-title">ครู</h1>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn btn-ghost btn-sm" href="/api/users/teachers/template">เทมเพลต</a>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)}><IconUpload width={16} height={16} /> นำเข้า</button>
          <a className="btn btn-secondary btn-sm" href="/api/users/teachers/export"><IconDownload width={16} height={16} /> ส่งออก</a>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><IconPlus width={16} height={16} /> เพิ่ม</button>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--skdw-muted)' }}><IconSearch width={18} height={18} /></span>
            <input className="form-input" style={{ paddingLeft: 38 }} placeholder="ค้นหารหัส / ชื่อ / อีเมล" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาครู" />
          </div>
          <select className="form-select" style={{ width: 170 }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="สิทธิ์">
            <option value="">ทุกสิทธิ์</option>
            <option value="teacher">teacher</option>
            <option value="teacher-admin">teacher-admin</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>กลุ่มสาระ</th><th>อีเมล</th><th>สิทธิ์</th><th></th></tr></thead>
            <tbody>
              {loading && rows.length === 0 && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 20 }} /></td></tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 40 }}>ไม่พบครูที่ค้นหา</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.teacherCode}</td>
                  <td>{r.prefix ?? ''}{r.firstName} {r.lastName}</td>
                  <td style={{ fontSize: 13 }}>{r.subjectGroup ?? '-'}</td>
                  <td className="mono" style={{ fontSize: 13 }}>{r.email ?? '-'}</td>
                  <td>
                    <span className={`badge ${r.role === 'teacher-admin' ? 'badge-gold' : 'badge-muted'}`}>{r.role}</span>
                  </td>
                  <td><Link href={`/users/teachers/${r.id}`} className="chip">ดู/แก้ไข</Link></td>
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

      {showImport && <ImportDialog kind="teachers" onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); load(1); }} />}
      {showNew && <NewTeacher onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(1); toast('เพิ่มครูแล้ว', 'success'); }} />}
    </div>
  );
}

function NewTeacher({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    teacherCode: '', prefix: 'นาย', firstName: '', lastName: '', email: '',
    subjectGroup: '', gradeTaught: '', role: 'teacher', password: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit() {
    if (!f.teacherCode || !f.firstName || !f.lastName) { toast('กรุณากรอกรหัส/ชื่อ/นามสกุล', 'error'); return; }
    setBusy(true);
    try { await api('/api/users/teachers', jsonBody(f)); onCreated(); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="เพิ่มครู">
      <div className="modal">
        <div className="card-header">เพิ่มครู</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div className="grid-2">
            <div><label className="form-label required">รหัสครู</label><input className="form-input" value={f.teacherCode} onChange={set('teacherCode')} placeholder="T00123" /></div>
            <div><label className="form-label">คำนำหน้า</label><input className="form-input" value={f.prefix} onChange={set('prefix')} /></div>
          </div>
          <div className="grid-2">
            <div><label className="form-label required">ชื่อ</label><input className="form-input" value={f.firstName} onChange={set('firstName')} /></div>
            <div><label className="form-label required">นามสกุล</label><input className="form-input" value={f.lastName} onChange={set('lastName')} /></div>
          </div>
          <div><label className="form-label">กลุ่มสาระที่สอน</label><input className="form-input" value={f.subjectGroup} onChange={set('subjectGroup')} /></div>
          <div className="grid-2">
            <div><label className="form-label">อีเมล</label><input className="form-input" value={f.email} onChange={set('email')} /></div>
            <div>
              <label className="form-label">สิทธิ์ (role)</label>
              <select className="form-select" value={f.role} onChange={set('role')}>
                <option value="teacher">teacher</option>
                <option value="teacher-admin">teacher-admin</option>
              </select>
            </div>
          </div>
          <div><label className="form-label">รหัสผ่าน</label><input className="form-input" value={f.password} onChange={set('password')} /></div>
        </div>
        <div className="row-between card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}

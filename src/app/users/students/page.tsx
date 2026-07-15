'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconSearch, IconPlus, IconDownload, IconUpload } from '@/components/Icons';
import { ImportDialog } from '@/components/ImportDialog';
import { NewStudentDialog } from '@/components/NewStudentDialog';
import { PhotoImportDialog } from '@/components/PhotoImportDialog';
import { PhotoThumb, PhotoLightbox } from '@/components/PhotoThumb';

interface Row {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; nickname: string | null;
  gender: string | null; status: string;
  gradeLevel: string | null; classroom: string | null; classNumber: string | null;
  hasPhoto: boolean;
}
interface Meta { grades: string[]; classrooms: string[]; }

const STATUS_LABEL: Record<string, string> = {
  studying: 'กำลังศึกษา', withdrawn: 'จำหน่าย/ลาออก', graduated: 'จบการศึกษา',
};

export default function StudentsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState('');
  const [classroom, setClassroom] = useState('');
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<Meta>({ grades: [], classrooms: [] });
  const [showImport, setShowImport] = useState(false);
  const [showPhotoImport, setShowPhotoImport] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [zoom, setZoom] = useState<Row | null>(null);
  const pageSize = 25;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    api<Meta>('/api/users/meta').then((m) => setMeta({ grades: m.grades, classrooms: m.classrooms })).catch(() => {});
  }, []);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (q) sp.set('q', q);
      if (grade) sp.set('grade', grade);
      if (classroom) sp.set('classroom', classroom);
      // Registry shows only students still on the roll — จบ/จำหน่าย/ลาออก live
      // on the นักเรียนเก่า page (/users/former-students).
      sp.set('status', 'studying');
      const res = await api<{ data: Row[]; total: number }>(`/api/users/students?${sp}`);
      setRows(res.data);
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [q, grade, classroom, toast]);

  // debounce search + filter changes
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(1), 300);
    return () => clearTimeout(debounceRef.current);
  }, [q, grade, classroom, load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  function exportXlsx() {
    const sp = new URLSearchParams();
    if (grade) sp.set('grade', grade);
    if (classroom) sp.set('classroom', classroom);
    window.location.href = `/api/users/students/export?${sp}`;
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <h1 className="page-title">นักเรียน</h1>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-ghost btn-sm" href="/users/former-students">นักเรียนเก่า</Link>
          <Link className="btn btn-ghost btn-sm" href={`/users/class-numbers${grade ? `?grade=${encodeURIComponent(grade)}${classroom ? `&classroom=${encodeURIComponent(classroom)}` : ''}` : ''}`}>จัดเลขที่</Link>
          <a className="btn btn-ghost btn-sm" href="/api/users/students/template">เทมเพลต</a>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)}><IconUpload width={16} height={16} /> นำเข้า</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPhotoImport(true)}><IconUpload width={16} height={16} /> นำเข้ารูป</button>
          <button className="btn btn-secondary btn-sm" onClick={exportXlsx}><IconDownload width={16} height={16} /> ส่งออก</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><IconPlus width={16} height={16} /> เพิ่ม</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--skdw-muted)' }}><IconSearch width={18} height={18} /></span>
            <input
              className="form-input"
              style={{ paddingLeft: 38 }}
              placeholder="ค้นหารหัส / ชื่อ / นามสกุล / ชื่อเล่น"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="ค้นหานักเรียน"
            />
          </div>
          <select className="form-select" style={{ width: 150 }} value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="กรองชั้น">
            <option value="">ทุกชั้น</option>
            {meta.grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select className="form-select" style={{ width: 130 }} value={classroom} onChange={(e) => setClassroom(e.target.value)} aria-label="กรองห้อง">
            <option value="">ทุกห้อง</option>
            {meta.classrooms.map((c) => <option key={c} value={c}>ห้อง {c}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>รูป</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ชื่อเล่น</th><th>เพศ</th><th>ชั้น</th><th>ห้อง</th><th>เลขที่</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={9}><div className="skeleton" style={{ height: 20 }} /></td></tr>
                ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }} className="muted">
                  ไม่พบนักเรียนที่ค้นหา
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ paddingTop: 6, paddingBottom: 6 }}>
                    <PhotoThumb
                      src={r.hasPhoto ? `/api/users/students/${r.id}/photo` : null}
                      initials={(r.firstName[0] ?? '') + (r.lastName[0] ?? '')}
                      alt={`${r.firstName} ${r.lastName}`}
                      onClick={() => setZoom(r)}
                    />
                  </td>
                  <td className="mono">{r.studentCode}</td>
                  <td>
                    {r.prefix ?? ''}{r.firstName} {r.lastName}
                    {r.status && r.status !== 'studying' && (
                      <span className="badge" style={{ marginLeft: 8, background: 'var(--skdw-bg)', fontSize: 11 }}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    )}
                  </td>
                  <td>{r.nickname ?? '-'}</td>
                  <td>{r.gender ?? '-'}</td>
                  <td>{r.gradeLevel ?? '-'}</td>
                  <td>{r.classroom ?? '-'}</td>
                  <td className="mono">{r.classNumber ?? '-'}</td>
                  <td><Link href={`/users/students/${r.id}`} className="chip">ดู/แก้ไข</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="row-between" style={{ padding: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>ทั้งหมด {total.toLocaleString('th-TH')} คน</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>ก่อนหน้า</button>
            <span style={{ fontSize: 13 }} className="mono">{page} / {pages}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pages || loading} onClick={() => load(page + 1)}>ถัดไป</button>
          </div>
        </div>
      </div>

      {showImport && (
        <ImportDialog
          kind="students"
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); load(1); }}
        />
      )}
      {showPhotoImport && (
        <PhotoImportDialog
          onClose={() => setShowPhotoImport(false)}
          onDone={() => setShowPhotoImport(false)}
        />
      )}
      {showNew && (
        <NewStudentDialog
          grades={meta.grades}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(1); toast('เพิ่มนักเรียนแล้ว', 'success'); }}
        />
      )}
      {zoom && (
        <PhotoLightbox
          src={`/api/users/students/${zoom.id}/photo`}
          alt={`${zoom.firstName} ${zoom.lastName}`}
          caption={`${zoom.studentCode} · ${zoom.prefix ?? ''}${zoom.firstName} ${zoom.lastName}`}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

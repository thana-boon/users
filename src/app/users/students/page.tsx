'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, withBase } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconSearch, IconPlus, IconDownload, IconUpload } from '@/components/Icons';
import { ImportDialog } from '@/components/ImportDialog';
import { NewStudentDialog } from '@/components/NewStudentDialog';
import { PhotoImportDialog } from '@/components/PhotoImportDialog';
import { PhotoThumb, PhotoLightbox } from '@/components/PhotoThumb';
import { useAccess } from '@/components/Access';

interface Row {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; nickname: string | null;
  gender: string | null; status: string;
  gradeLevel: string | null; classroom: string | null; classNumber: string | null;
  hasPhoto: boolean;
  /** Leave type when the student is พักการเรียน right now; status stays 'studying'. */
  onLeave: string | null;
}
interface RosterRoom { gradeLevel: string; classroom: string | null; count: number; }
interface Meta {
  grades: string[]; classrooms: string[]; rooms: { gradeLevel: string; classroom: string }[];
  /** Headcount per ชั้น/ห้อง of students on the roll — rooms with nobody aren't in it. */
  roster: RosterRoom[];
}

const STATUS_LABEL: Record<string, string> = {
  studying: 'กำลังศึกษา', withdrawn: 'จำหน่าย/ลาออก', graduated: 'จบการศึกษา',
};

export default function StudentsPage() {
  // A moderator sees only the buttons their grants back (the API enforces it).
  const { can } = useAccess();
  const canWrite = can('/api/users/students', 'POST');
  const canExport = can('/api/users/students/export');
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState('');
  const [classroom, setClassroom] = useState('');
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<Meta>({ grades: [], classrooms: [], rooms: [], roster: [] });
  const [showImport, setShowImport] = useState(false);
  const [showPhotoImport, setShowPhotoImport] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [zoom, setZoom] = useState<Row | null>(null);
  const pageSize = 25;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadMeta = useCallback(() => {
    api<Meta>('/api/users/meta')
      .then((m) => setMeta({ grades: m.grades, classrooms: m.classrooms, rooms: m.rooms ?? [], roster: m.roster ?? [] }))
      .catch(() => {});
  }, []);
  useEffect(loadMeta, [loadMeta]);

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

  // Grade tabs and room tiles come from the roster, so a ชั้น or ห้อง with no
  // one on the roll never shows up to be picked.
  const gradeTabs = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of meta.roster) m.set(r.gradeLevel, (m.get(r.gradeLevel) ?? 0) + r.count);
    return [...m].map(([g, count]) => ({ grade: g, count }));
  }, [meta.roster]);
  const rosterTotal = gradeTabs.reduce((n, g) => n + g.count, 0);
  const roomTiles = useMemo(
    () => meta.roster.filter(
      (r): r is RosterRoom & { classroom: string } => r.gradeLevel === grade && !!r.classroom && r.count > 0,
    ),
    [meta.roster, grade],
  );

  function pickGrade(g: string) {
    setGrade(g);
    setClassroom('');
  }

  const scope = grade ? (classroom ? `${grade}/${classroom}` : grade) : 'ทุกชั้น';
  const inRoom = !!(grade && classroom);

  function exportXlsx() {
    const sp = new URLSearchParams();
    if (grade) sp.set('grade', grade);
    if (classroom) sp.set('classroom', classroom);
    window.location.href = withBase(`/api/users/students/export?${sp}`);
  }

  function refresh() {
    load(1);
    loadMeta();
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <h1 className="page-title">ทะเบียนนักเรียน</h1>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {can('/users/former-students') && <Link className="btn btn-ghost btn-sm" href="/users/former-students">นักเรียนเก่า</Link>}
          {can('/users/class-numbers') && <Link className="btn btn-ghost btn-sm" href={`/users/class-numbers${grade ? `?grade=${encodeURIComponent(grade)}${classroom ? `&classroom=${encodeURIComponent(classroom)}` : ''}` : ''}`}>จัดเลขที่</Link>}
          {canWrite && <>
            <a className="btn btn-ghost btn-sm" href={withBase('/api/users/students/template')}>เทมเพลต</a>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)}><IconUpload width={16} height={16} /> นำเข้า</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPhotoImport(true)}><IconUpload width={16} height={16} /> นำเข้ารูป</button>
          </>}
          {canExport && <button className="btn btn-secondary btn-sm" onClick={exportXlsx}><IconDownload width={16} height={16} /> ส่งออก {scope}</button>}
          {canWrite && <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><IconPlus width={16} height={16} /> เพิ่มนักเรียน</button>}
        </div>
      </div>

      <section className="reg-filter" aria-label="เลือกชั้นและห้อง">
        <div className="reg-search">
          <IconSearch width={18} height={18} aria-hidden />
          <input
            className="form-input"
            placeholder="ค้นหารหัส / ชื่อ / นามสกุล / ชื่อเล่น"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="ค้นหานักเรียน"
          />
        </div>

        <div className="reg-grades" role="group" aria-label="ชั้น">
          <button type="button" className="reg-grade" aria-pressed={!grade} onClick={() => pickGrade('')}>
            ทุกชั้น <span className="reg-grade-n">{rosterTotal.toLocaleString('th-TH')}</span>
          </button>
          {gradeTabs.map((g) => (
            <button key={g.grade} type="button" className="reg-grade" aria-pressed={grade === g.grade} onClick={() => pickGrade(g.grade)}>
              {g.grade} <span className="reg-grade-n">{g.count.toLocaleString('th-TH')}</span>
            </button>
          ))}
        </div>

        {grade && roomTiles.length > 0 && (
          <div className="reg-rooms" role="group" aria-label={`ห้องของ ${grade}`}>
            <button type="button" className="reg-room reg-room-all" aria-pressed={!classroom} onClick={() => setClassroom('')}>
              ทุกห้อง
            </button>
            {roomTiles.map((r) => (
              <button
                key={r.classroom}
                type="button"
                className="reg-room"
                aria-pressed={classroom === r.classroom}
                aria-label={`ห้อง ${r.classroom} ${r.count} คน`}
                onClick={() => setClassroom(r.classroom)}
              >
                <span className="reg-room-no">{r.classroom}</span>
                <span className="reg-room-n">{r.count} คน</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* The roll */}
      <div className="card reg-roll">
        <header className="reg-roll-head">
          <h2 className="reg-scope">{scope}</h2>
          <p className="reg-count">
            {loading && rows.length === 0 ? 'กำลังโหลด…' : (
              <>
                {q ? 'พบ ' : ''}{total.toLocaleString('th-TH')} คน
                {grade && !classroom && !q && roomTiles.length > 1 && <> ใน {roomTiles.length} ห้อง</>}
              </>
            )}
          </p>
        </header>
        <div className="table-wrap">
          <table className="table reg-table">
            <thead>
              <tr>
                {inRoom && <th className="reg-no">เลขที่</th>}
                <th style={{ width: 48 }}><span className="sr-only">รูป</span></th>
                <th>ชื่อ-นามสกุล</th><th>ชื่อเล่น</th><th>เพศ</th><th>รหัส</th>
                {!inRoom && <><th>ชั้น/ห้อง</th><th className="reg-no">เลขที่</th></>}
                <th><span className="sr-only">เปิดประวัติ</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={8}><div className="skeleton" style={{ height: 20 }} /></td></tr>
                ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="reg-empty">
                  {q
                    ? <>ไม่มีนักเรียนตรงกับ “{q}” ใน{scope} <button type="button" className="reg-linkbtn" onClick={() => setQ('')}>ล้างคำค้น</button></>
                    : <>ยังไม่มีนักเรียนใน{scope}{canWrite && <> <button type="button" className="reg-linkbtn" onClick={() => setShowNew(true)}>เพิ่มนักเรียน</button></>}</>}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  {inRoom && <td className="reg-no mono">{r.classNumber ?? '–'}</td>}
                  <td style={{ paddingTop: 6, paddingBottom: 6 }}>
                    <PhotoThumb
                      src={r.hasPhoto ? `/api/users/students/${r.id}/photo` : null}
                      initials={(r.firstName[0] ?? '') + (r.lastName[0] ?? '')}
                      alt={`${r.firstName} ${r.lastName}`}
                      onClick={() => setZoom(r)}
                    />
                  </td>
                  <td>
                    <Link href={`/users/students/${r.id}`} className="reg-name">
                      {r.prefix ?? ''}{r.firstName} {r.lastName}
                    </Link>
                    {r.status && r.status !== 'studying' && (
                      <span className="badge badge-muted" style={{ marginLeft: 8 }}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    )}
                    {r.onLeave && (
                      <span className="badge badge-warning" style={{ marginLeft: 8 }}>{r.onLeave}</span>
                    )}
                  </td>
                  <td>{r.nickname ?? <span className="muted">–</span>}</td>
                  <td>{r.gender ?? <span className="muted">–</span>}</td>
                  <td className="mono muted">{r.studentCode}</td>
                  {!inRoom && <>
                    <td>{r.gradeLevel ? `${r.gradeLevel}${r.classroom ? `/${r.classroom}` : ''}` : <span className="muted">–</span>}</td>
                    <td className="reg-no mono">{r.classNumber ?? '–'}</td>
                  </>}
                  <td style={{ textAlign: 'right' }}><Link href={`/users/students/${r.id}`} className="chip">ดู/แก้ไข</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="row-between reg-pager">
            <span className="muted">หน้า {page} จาก {pages}</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>ก่อนหน้า</button>
              <button className="btn btn-ghost btn-sm" disabled={page >= pages || loading} onClick={() => load(page + 1)}>ถัดไป</button>
            </div>
          </div>
        )}
      </div>

      {showImport && (
        <ImportDialog
          kind="students"
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); refresh(); }}
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
          rooms={meta.rooms}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); toast('เพิ่มนักเรียนแล้ว', 'success'); }}
        />
      )}
      {zoom && (
        <PhotoLightbox
          src={`/api/users/students/${zoom.id}/photo`}
          alt={`${zoom.firstName} ${zoom.lastName}`}
          caption={`${zoom.studentCode} ${zoom.prefix ?? ''}${zoom.firstName} ${zoom.lastName}`}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

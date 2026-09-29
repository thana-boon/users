'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, jsonBody, withBase } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconSearch, IconPlus, IconDownload, IconUpload } from '@/components/Icons';
import { ImportDialog } from '@/components/ImportDialog';
import { NewStudentDialog } from '@/components/NewStudentDialog';
import { PhotoImportDialog } from '@/components/PhotoImportDialog';
import { PhotoThumb, PhotoLightbox } from '@/components/PhotoThumb';
import { useAccess } from '@/components/Access';
import { rememberStudentList, lastStudentId } from '@/lib/student-list-nav';

interface Row {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; nickname: string | null;
  gender: string | null; status: string;
  gradeLevel: string | null; classroom: string | null; classNumber: string | null;
  enrollmentId: number;
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
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
      <Registry />
    </Suspense>
  );
}

/** What the roll on screen was loaded for — the table is drawn from this, not
 *  from the filters, so its columns never switch before the new rows arrive. */
interface View { rows: Row[]; total: number; page: number; inRoom: boolean; q: string }

function Registry() {
  // A moderator sees only the buttons their grants back (the API enforces it).
  const { can } = useAccess();
  const canWrite = can('/api/users/students', 'POST');
  const canExport = can('/api/users/students/export');
  const toast = useToast();
  // Filters live in the URL, so Back from a student's record (or a reload)
  // returns to the same ชั้น/ห้อง/page instead of the whole school.
  const search = useSearchParams();
  const [q, setQ] = useState(() => search.get('q') ?? '');
  const [qd, setQd] = useState(q); // debounced — only typing waits
  const [grade, setGrade] = useState(() => search.get('grade') ?? '');
  const [classroom, setClassroom] = useState(() => search.get('classroom') ?? '');
  const [page, setPage] = useState(() => Math.max(1, Number(search.get('page')) || 1));
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastId, setLastId] = useState<number | null>(null);
  const [meta, setMeta] = useState<Meta>({ grades: [], classrooms: [], rooms: [], roster: [] });
  const [showImport, setShowImport] = useState(false);
  const [showPhotoImport, setShowPhotoImport] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [zoom, setZoom] = useState<Row | null>(null);
  // A room is a roll book: the whole class on one page, so a clashing เลขที่
  // is always in sight.
  const pageSize = grade && classroom ? 100 : 25;
  const seq = useRef(0);
  const scrolledToLast = useRef(false);

  const loadMeta = useCallback(() => {
    api<Meta>('/api/users/meta')
      .then((m) => setMeta({ grades: m.grades, classrooms: m.classrooms, rooms: m.rooms ?? [], roster: m.roster ?? [] }))
      .catch(() => {});
  }, []);
  useEffect(loadMeta, [loadMeta]);
  useEffect(() => setLastId(lastStudentId()), []);

  useEffect(() => {
    if (q === qd) return;
    const t = setTimeout(() => { setQd(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q, qd]);

  useEffect(() => {
    const filters = new URLSearchParams();
    if (qd) filters.set('q', qd);
    if (grade) filters.set('grade', grade);
    if (classroom) filters.set('classroom', classroom);
    if (page > 1) filters.set('page', String(page));
    const qs = filters.size ? `?${filters}` : '';
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs}`);
    rememberStudentList(qs);

    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (qd) sp.set('q', qd);
    if (grade) sp.set('grade', grade);
    if (classroom) sp.set('classroom', classroom);
    // Registry shows only students still on the roll — จบ/จำหน่าย/ลาออก live
    // on the นักเรียนเก่า page (/users/former-students).
    sp.set('status', 'studying');

    // A slower earlier request must not overwrite a newer one's rows.
    const my = ++seq.current;
    setLoading(true);
    api<{ data: Row[]; total: number }>(`/api/users/students?${sp}`)
      .then((res) => {
        if (my !== seq.current) return;
        const last = Math.max(1, Math.ceil(res.total / pageSize));
        // A remembered page past the end (the roll shrank since) → its last page.
        if (page > last) { setPage(last); return; }
        setView({ rows: res.data, total: res.total, page, inRoom: !!(grade && classroom), q: qd });
      })
      .catch((e) => { if (my === seq.current) toast((e as Error).message, 'error'); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [qd, grade, classroom, page, pageSize, reloadKey, toast]);

  // Coming back from a record: bring the student just viewed into sight, so
  // the next one down is right there.
  useEffect(() => {
    if (scrolledToLast.current || !view || lastId == null) return;
    scrolledToLast.current = true;
    if (view.rows.some((r) => r.id === lastId)) {
      document.getElementById(`stu-${lastId}`)?.scrollIntoView({ block: 'center' });
    }
  }, [view, lastId]);

  const rows = view?.rows ?? [];
  const total = view?.total ?? 0;
  const inRoom = view?.inRoom ?? false;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // เลขที่ held by more than one student of the same room, among the rows shown.
  const clashes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) if (r.classNumber) seen.set(seatKey(r), (seen.get(seatKey(r)) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rows]);

  function numberSaved(id: number, classNumber: string | null) {
    setView((v) => v && { ...v, rows: v.rows.map((r) => (r.id === id ? { ...r, classNumber } : r)) });
  }

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
    setPage(1);
  }
  function pickRoom(c: string) {
    setClassroom(c);
    setPage(1);
  }

  const scope = grade ? (classroom ? `${grade}/${classroom}` : grade) : 'ทุกชั้น';

  function exportXlsx() {
    const sp = new URLSearchParams();
    if (grade) sp.set('grade', grade);
    if (classroom) sp.set('classroom', classroom);
    window.location.href = withBase(`/api/users/students/export?${sp}`);
  }

  function refresh() {
    setPage(1);
    setReloadKey((k) => k + 1);
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
            <button type="button" className="reg-room reg-room-all" aria-pressed={!classroom} onClick={() => pickRoom('')}>
              ทุกห้อง
            </button>
            {roomTiles.map((r) => (
              <button
                key={r.classroom}
                type="button"
                className="reg-room"
                aria-pressed={classroom === r.classroom}
                aria-label={`ห้อง ${r.classroom} ${r.count} คน`}
                onClick={() => pickRoom(r.classroom)}
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
            {!view ? 'กำลังโหลด…' : (
              <>
                {view.q ? 'พบ ' : ''}{total.toLocaleString('th-TH')} คน
                {grade && !classroom && !view.q && roomTiles.length > 1 && <> ใน {roomTiles.length} ห้อง</>}
              </>
            )}
          </p>
        </header>
        <div className="table-wrap">
          <table className="table reg-table" aria-busy={loading} data-stale={loading && !!view ? '' : undefined}>
            <thead>
              <tr>
                {inRoom && <th className="reg-no">เลขที่</th>}
                <th className="reg-c-photo"><span className="sr-only">รูป</span></th>
                <th>ชื่อ-นามสกุล</th><th className="reg-c-nick">ชื่อเล่น</th><th className="reg-c-gender">เพศ</th><th className="reg-c-code">รหัส</th>
                {!inRoom && <><th className="reg-c-room">ชั้น/ห้อง</th><th className="reg-no">เลขที่</th></>}
                <th className="reg-c-open"><span className="sr-only">เปิดประวัติ</span></th>
              </tr>
            </thead>
            <tbody>
              {!view &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={8}><div className="skeleton" style={{ height: 20 }} /></td></tr>
                ))}
              {view && rows.length === 0 && (
                <tr><td colSpan={8} className="reg-empty">
                  {view.q
                    ? <>ไม่มีนักเรียนตรงกับ “{view.q}” ใน{scope} <button type="button" className="reg-linkbtn" onClick={() => setQ('')}>ล้างคำค้น</button></>
                    : <>ยังไม่มีนักเรียนใน{scope}{canWrite && <> <button type="button" className="reg-linkbtn" onClick={() => setShowNew(true)}>เพิ่มนักเรียน</button></>}</>}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} id={`stu-${r.id}`} className={r.id === lastId ? 'reg-row-last' : undefined}>
                  {inRoom && <td className="reg-no mono">
                      {canWrite
                        ? <ClassNumberInput row={r} clash={!!r.classNumber && clashes.has(seatKey(r))} onSaved={numberSaved} />
                        : r.classNumber ?? '–'}
                    </td>}
                  <td style={{ paddingTop: 6, paddingBottom: 6 }}>
                    <PhotoThumb
                      src={r.hasPhoto ? `/api/users/students/${r.id}/photo?thumb=1` : null}
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
                    <td className="reg-no mono">
                      {canWrite
                        ? <ClassNumberInput row={r} clash={!!r.classNumber && clashes.has(seatKey(r))} onSaved={numberSaved} />
                        : r.classNumber ?? '–'}
                    </td>
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
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
              <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>ถัดไป</button>
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

const seatKey = (r: Row) => `${r.gradeLevel ?? ''}/${r.classroom ?? ''}#${r.classNumber}`;

/** เลขที่ typed straight into the roll: saved on Enter (which drops to the
 *  next student's box) or on leaving the box; Esc puts the old number back. */
function ClassNumberInput({ row, clash, onSaved }: {
  row: Row; clash: boolean; onSaved: (id: number, classNumber: string | null) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(row.classNumber ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(row.classNumber ?? ''), [row.classNumber]);

  async function commit() {
    const v = draft.trim();
    if (v === (row.classNumber ?? '')) return;
    if (v && !/^\d{1,3}$/.test(v)) {
      toast('เลขที่ต้องเป็นตัวเลข', 'error');
      setDraft(row.classNumber ?? '');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ classNumber: string | null; duplicates: { prefix: string | null; firstName: string; lastName: string }[] }>(
        `/api/users/students/${row.id}/class-number`,
        jsonBody({ enrollmentId: row.enrollmentId, classNumber: v || null }),
      );
      setDraft(res.classNumber ?? '');
      onSaved(row.id, res.classNumber);
      if (res.duplicates.length) {
        const who = res.duplicates.map((d) => `${d.prefix ?? ''}${d.firstName} ${d.lastName}`).join(', ');
        toast(`เลขที่ ${res.classNumber} ซ้ำกับ ${who} ในห้องเดียวกัน`, 'error');
      }
    } catch (e) {
      toast((e as Error).message, 'error');
      setDraft(row.classNumber ?? '');
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      className={`form-input mono reg-no-input${clash ? ' error' : ''}`}
      inputMode="numeric"
      maxLength={3}
      value={draft}
      disabled={saving}
      aria-label={`เลขที่ของ ${row.firstName} ${row.lastName}`}
      aria-invalid={clash || undefined}
      title={clash ? 'เลขที่ซ้ำกับนักเรียนอีกคนในห้อง' : undefined}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const boxes = [...document.querySelectorAll<HTMLInputElement>('.reg-no-input')];
          const next = boxes[boxes.indexOf(e.currentTarget) + 1];
          if (next) next.focus(); else e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(row.classNumber ?? '');
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

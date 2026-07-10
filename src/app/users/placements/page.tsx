'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { PlacementImportDialog } from '@/components/PlacementImportDialog';
import { GRADE_ORDER } from '@/lib/grades';

/**
 * จัดนักเรียนเข้าห้อง — build a (year, grade) roster by dragging students from a
 * "กองรอจัด" pool into room columns. The pool is fed two ways:
 *   1. quick-add a brand-new student (name + code) — a stand-in until the
 *      admission/รับสมัคร system feeds this pool directly, and
 *   2. pull an existing student who has NO enrollment this year (re-entry /
 *      mid-year transfer-in) via search.
 * Room columns also show who is ALREADY enrolled there (context, not draggable).
 * Submit enrolls every pooled student that has been dropped into a room via
 * POST /api/users/placements.
 */

interface YearOpt { id: number; year: number; isActive: boolean }
interface Meta { years: YearOpt[]; grades: string[]; classrooms: string[] }
interface RosterRow {
  enrollmentId: number; studentId: number; studentCode: string;
  prefix: string | null; firstName: string; lastName: string;
  gender: string | null; status: string;
  gradeLevel: string | null; classroom: string | null; classNumber: string | null;
}
interface UnplacedRow {
  id: number; studentCode: string;
  prefix: string | null; firstName: string; lastName: string;
  gender: string | null; status: string;
  lastGrade: string | null; lastRoom: string | null; lastYear: number | null;
}
interface NewStudent { studentCode: string; prefix: string | null; firstName: string; lastName: string; gender: string | null }
interface PoolItem {
  key: string;                 // stable local key: `new:<code>` or `exist:<id>`
  kind: 'new' | 'existing';
  studentId?: number;
  newStudent?: NewStudent;
  studentCode: string;
  name: string;
  gender: string | null;
  context: string | null;      // where they came from, e.g. "ป.6/2 · 2568"
}

const POOL = 'pool';
const roomKey = (name: string) => `room:${name}`;
const byRoom = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });

const STATUS_LABEL: Record<string, string> = {
  studying: 'กำลังศึกษา', withdrawn: 'จำหน่าย/ลาออก', graduated: 'จบการศึกษา',
};
const fullName = (r: { prefix: string | null; firstName: string; lastName: string }) =>
  `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim();

/** "ป.6/2 · 2568" from the student's latest enrollment — null if unknown. */
const contextLabel = (grade: string | null, room: string | null, year: number | null): string | null => {
  if (!grade && !room && year == null) return null;
  const gr = `${grade ?? '-'}${room ? `/${room}` : ''}`;
  return year != null ? `${gr} · ${year}` : gr;
};

interface Column { key: string; label: string; room: string | null; kind: 'pool' | 'room' }

export default function PlacementsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [meta, setMeta] = useState<Meta>({ years: [], grades: [], classrooms: [] });
  const [yearId, setYearId] = useState<number | ''>('');
  const [grade, setGrade] = useState('');
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);

  // The pool of students to place, and where each currently sits (POOL or a room).
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [extraRooms, setExtraRooms] = useState<string[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [newRoom, setNewRoom] = useState('');
  const [renumber, setRenumber] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Quick-add form.
  const [qa, setQa] = useState<NewStudent>({ studentCode: '', prefix: '', firstName: '', lastName: '', gender: '' });
  // Search existing unplaced students.
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UnplacedRow[]>([]);
  const [searching, setSearching] = useState(false);

  const dragIds = useRef<string[]>([]);

  useEffect(() => {
    api<Meta>('/api/users/meta').then((m) => {
      setMeta(m);
      const active = m.years.find((y) => y.isActive) ?? m.years[m.years.length - 1];
      if (active) setYearId(active.id);
    }).catch(() => {});
  }, []);

  const loadRoster = useCallback(async () => {
    if (!yearId || !grade) { setRoster([]); return; }
    setLoading(true);
    try {
      const sp = new URLSearchParams({ yearId: String(yearId), grade });
      const res = await api<{ data: RosterRow[] }>(`/api/users/enrollments?${sp}`);
      setRoster(res.data);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [yearId, grade, toast]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  // Debounced search for existing students with no enrollment this year.
  useEffect(() => {
    if (!yearId) { setResults([]); return; }
    const term = q.trim();
    if (!term) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ yearId: String(yearId), q: term });
        const res = await api<{ data: UnplacedRow[] }>(`/api/users/students/unplaced?${sp}`);
        setResults(res.data);
      } catch { /* ignore */ } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, yearId]);

  const columns = useMemo<Column[]>(() => {
    const roomSet = new Set<string>();
    for (const r of roster) if (r.classroom) roomSet.add(r.classroom);
    for (const r of extraRooms) roomSet.add(r);
    const rooms: Column[] = [...roomSet].sort(byRoom).map((name) => ({
      key: roomKey(name), label: `ห้อง ${name}`, room: name, kind: 'room' as const,
    }));
    return [{ key: POOL, label: 'กองรอจัด', room: null, kind: 'pool' }, ...rooms];
  }, [roster, extraRooms]);

  // Existing enrolled occupants per room (context — shown dimmed, not draggable).
  const occupantsByRoom = useMemo(() => {
    const m = new Map<string, RosterRow[]>();
    for (const r of roster) {
      const k = r.classroom ? roomKey(r.classroom) : '';
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  }, [roster]);

  // Pool items grouped by their assigned column.
  const poolByCol = useMemo(() => {
    const m = new Map<string, PoolItem[]>();
    for (const c of columns) m.set(c.key, []);
    for (const p of pool) {
      const k = assign[p.key] ?? POOL;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return m;
  }, [pool, assign, columns]);

  const placedItems = useMemo(
    () => pool.filter((p) => (assign[p.key] ?? POOL) !== POOL),
    [pool, assign],
  );
  const poolCount = pool.length - placedItems.length;

  const year = meta.years.find((y) => y.id === yearId)?.year;

  // -- pool management --
  const addToPool = (item: PoolItem) => {
    setPool((ps) => (ps.some((p) => p.key === item.key) ? ps : [...ps, item]));
    setAssign((a) => (a[item.key] ? a : { ...a, [item.key]: POOL }));
  };
  const removeFromPool = (key: string) => {
    setPool((ps) => ps.filter((p) => p.key !== key));
    setAssign((a) => { const n = { ...a }; delete n[key]; return n; });
    setSel((s) => { const n = new Set(s); n.delete(key); return n; });
  };

  const addQuickAdd = () => {
    const code = qa.studentCode.trim();
    const first = qa.firstName.trim();
    const last = qa.lastName.trim();
    if (!code || !first || !last) return toast('กรอกรหัส ชื่อ และนามสกุลให้ครบ', 'error');
    if (pool.some((p) => p.studentCode === code)) return toast('รหัสนี้อยู่ในกองแล้ว', 'error');
    const ns: NewStudent = {
      studentCode: code, prefix: qa.prefix?.trim() || null,
      firstName: first, lastName: last, gender: qa.gender?.trim() || null,
    };
    addToPool({
      key: `new:${code}`, kind: 'new', newStudent: ns,
      studentCode: code, name: fullName(ns), gender: ns.gender, context: null,
    });
    setQa({ studentCode: '', prefix: '', firstName: '', lastName: '', gender: '' });
  };

  const addExisting = (r: UnplacedRow) => {
    addToPool({
      key: `exist:${r.id}`, kind: 'existing', studentId: r.id,
      studentCode: r.studentCode, name: fullName(r), gender: r.gender,
      context: contextLabel(r.lastGrade, r.lastRoom, r.lastYear),
    });
  };

  // -- selection + move --
  const toggleSel = (key: string) =>
    setSel((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const clearSel = () => setSel(new Set());

  const moveTo = useCallback((keys: string[], colKey: string) => {
    if (!keys.length) return;
    setAssign((a) => { const n = { ...a }; for (const k of keys) n[k] = colKey; return n; });
  }, []);

  const onDragStart = (key: string, e: React.DragEvent) => {
    dragIds.current = sel.has(key) ? [...sel] : [key];
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropCol = (colKey: string) => {
    moveTo(dragIds.current, colKey);
    dragIds.current = [];
    setDragOverCol(null);
    clearSel();
  };

  const addRoom = () => {
    const name = newRoom.trim();
    if (!name) return;
    if (!extraRooms.includes(name) && !roster.some((r) => r.classroom === name)) {
      setExtraRooms((r) => [...r, name]);
    }
    setNewRoom('');
  };

  const colOf = (k: string) => columns.find((c) => c.key === k);

  async function submit() {
    if (!yearId) return toast('เลือกปีการศึกษา', 'error');
    if (!grade.trim()) return toast('เลือกชั้น', 'error');
    if (!placedItems.length) return toast('ยังไม่มีนักเรียนที่จัดเข้าห้อง (ลากจากกองรอจัดไปห้อง)', 'error');

    const summary = placedItems
      .map((p) => `${p.name}${p.kind === 'new' ? ' (ใหม่)' : ''} → ${colOf(assign[p.key])?.room ?? '-'}`)
      .slice(0, 8)
      .join('\n');
    const createdCount = placedItems.filter((p) => p.kind === 'new').length;

    if (!(await confirm({
      title: 'ยืนยันจัดนักเรียนเข้าห้อง',
      message:
        `จัด ${placedItems.length} คน เข้าชั้น ${grade} ปี ${year}` +
        (createdCount ? ` (เพิ่มนักเรียนใหม่ ${createdCount} คน)` : '') +
        `\n${summary}` +
        (placedItems.length > 8 ? `\n…และอีก ${placedItems.length - 8} คน` : '') +
        (renumber ? '\nและรันเลขที่ใหม่ทุกห้องในชั้นนี้' : ''),
      confirmText: `จัด ${placedItems.length} คน`,
    }))) return;

    setBusy(true);
    try {
      const items = placedItems.map((p) => ({
        studentId: p.kind === 'existing' ? p.studentId : undefined,
        newStudent: p.kind === 'new' ? p.newStudent : undefined,
        targetClassroom: colOf(assign[p.key])?.room ?? null,
      }));
      const res = await api<{ placed: number; created: number }>(
        '/api/users/placements',
        jsonBody({ yearId, grade, renumber, items }),
      );
      toast(
        `จัดเข้าห้อง ${res.placed} คนสำเร็จ${res.created ? ` (เพิ่มใหม่ ${res.created} คน)` : ''}`,
        'success',
      );
      // Drop the placed items from the pool; reload so they appear as occupants.
      const placedKeys = new Set(placedItems.map((p) => p.key));
      setPool((ps) => ps.filter((p) => !placedKeys.has(p.key)));
      setAssign((a) => {
        const n = { ...a };
        for (const k of placedKeys) delete n[k];
        return n;
      });
      loadRoster();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const poolKeysInResults = new Set(pool.map((p) => p.key));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">จัดนักเรียนเข้าห้อง</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            สร้างรายชื่อห้องของชั้น/ปีที่เลือก โดยลากนักเรียนจาก “กองรอจัด” ไปยังห้อง — เพิ่มนักเรียนใหม่ (มอบตัว)
            หรือดึงนักเรียนที่ยังไม่มีห้องในปีนี้ (เข้าระหว่างทาง) เข้ากองได้. ห้องจะแสดงคนที่มีอยู่แล้วเป็นพื้นหลังให้เห็นภาพ.
            หรือ<strong>นำเข้าเป็นชุดด้วย CSV</strong> (รหัส, ชั้น, ห้อง) เพื่อจัดทีละหลายคนข้ามหลายห้อง.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" disabled={!yearId} onClick={() => setImportOpen(true)}>
          นำเข้า CSV (รหัส, ชั้น, ห้อง)
        </button>
      </div>

      {/* Target year + grade */}
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">ปีการศึกษา</label>
            <select className="form-select" style={{ width: 150 }} value={yearId}
              onChange={(e) => setYearId(Number(e.target.value))}>
              {meta.years.map((y) => <option key={y.id} value={y.id}>{y.year}{y.isActive ? ' (ปัจจุบัน)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">ชั้น</label>
            <input list="place-grades" className="form-input" style={{ width: 150 }} value={grade}
              onChange={(e) => setGrade(e.target.value)} placeholder="เช่น ม.1" />
            <datalist id="place-grades">
              {[...new Set([...meta.grades, ...GRADE_ORDER])].map((g) => <option key={g} value={g} />)}
            </datalist>
          </div>
        </div>
      </div>

      {/* Pool builders: quick-add + search */}
      {grade && (
        <div className="card" style={{ padding: 16 }}>
          <div className="stack" style={{ gap: 14 }}>
            <div>
              <strong style={{ fontSize: 14 }}>เพิ่มนักเรียนใหม่ (มอบตัว)</strong>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-end' }}>
                <div>
                  <label className="form-label">รหัสนักเรียน</label>
                  <input className="form-input" style={{ width: 130 }} value={qa.studentCode}
                    onChange={(e) => setQa({ ...qa, studentCode: e.target.value })} placeholder="รหัส" />
                </div>
                <div>
                  <label className="form-label">คำนำหน้า</label>
                  <input className="form-input" style={{ width: 90 }} value={qa.prefix ?? ''}
                    onChange={(e) => setQa({ ...qa, prefix: e.target.value })} placeholder="ด.ช." />
                </div>
                <div>
                  <label className="form-label">ชื่อ</label>
                  <input className="form-input" style={{ width: 140 }} value={qa.firstName}
                    onChange={(e) => setQa({ ...qa, firstName: e.target.value })} placeholder="ชื่อ" />
                </div>
                <div>
                  <label className="form-label">นามสกุล</label>
                  <input className="form-input" style={{ width: 140 }} value={qa.lastName}
                    onChange={(e) => setQa({ ...qa, lastName: e.target.value })} placeholder="นามสกุล" />
                </div>
                <div>
                  <label className="form-label">เพศ</label>
                  <select className="form-select" style={{ width: 90 }} value={qa.gender ?? ''}
                    onChange={(e) => setQa({ ...qa, gender: e.target.value })}>
                    <option value="">—</option>
                    <option value="ชาย">ชาย</option>
                    <option value="หญิง">หญิง</option>
                  </select>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={addQuickAdd}>+ เพิ่มเข้ากอง</button>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                กรอกแค่รหัส/ชื่อ/นามสกุลก่อนได้ ข้อมูลอื่นค่อยแก้ทีหลังในหน้าทะเบียน
              </p>
            </div>

            <div style={{ borderTop: '0.5px solid var(--skdw-border)', paddingTop: 14 }}>
              <strong style={{ fontSize: 14 }}>ดึงนักเรียนที่ยังไม่มีห้องในปีนี้</strong>
              <input className="form-input" style={{ width: 280, marginTop: 8, display: 'block' }} value={q}
                onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ หรือรหัสนักเรียน" />
              {q.trim() && (
                <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                  {searching && <span className="muted" style={{ fontSize: 13 }}>กำลังค้นหา…</span>}
                  {!searching && results.length === 0 && (
                    <span className="muted" style={{ fontSize: 13 }}>ไม่พบนักเรียนที่ยังไม่มีห้อง</span>
                  )}
                  {results.map((r) => {
                    const inPool = poolKeysInResults.has(`exist:${r.id}`);
                    return (
                      <div key={r.id} className="row-between" style={{ gap: 10,
                        padding: '6px 10px', border: '1px solid var(--skdw-border)', borderRadius: 8 }}>
                        <span style={{ fontSize: 13 }}>
                          {fullName(r)} <span className="mono muted" style={{ fontSize: 11 }}>{r.studentCode}</span>
                          {contextLabel(r.lastGrade, r.lastRoom, r.lastYear) && (
                            <span className="muted"> • {contextLabel(r.lastGrade, r.lastRoom, r.lastYear)}</span>
                          )}
                          {r.status !== 'studying' && <span className="muted"> • {STATUS_LABEL[r.status] ?? r.status}</span>}
                        </span>
                        <button className="btn btn-ghost btn-sm" disabled={inPool} onClick={() => addExisting(r)}>
                          {inPool ? 'อยู่ในกองแล้ว' : '+ เพิ่ม'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      {grade && (
        <div className="card" style={{ padding: 12 }}>
          <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="badge badge-purple">จัดแล้ว {placedItems.length}</span>
              {poolCount > 0 && <span className="badge badge-muted">รอจัด {poolCount}</span>}
              {sel.size > 0 && (
                <>
                  <span className="muted" style={{ fontSize: 13 }}>เลือก {sel.size} คน →</span>
                  <select className="form-select" style={{ width: 190 }} defaultValue=""
                    onChange={(e) => { if (e.target.value) { moveTo([...sel], e.target.value); clearSel(); } e.target.value = ''; }}>
                    <option value="">ย้ายไป…</option>
                    {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <button className="btn btn-ghost btn-sm" onClick={clearSel}>ยกเลิกเลือก</button>
                </>
              )}
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input className="form-input" style={{ width: 130 }} placeholder="ชื่อห้องใหม่ เช่น 1"
                value={newRoom} onChange={(e) => setNewRoom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addRoom(); }} />
              <button className="btn btn-ghost btn-sm" onClick={addRoom}>+ เพิ่มห้อง</button>
            </div>
          </div>
        </div>
      )}

      {/* Board */}
      {grade && (
        loading ? (
          <div className="card" style={{ padding: 16 }}><div className="skeleton" style={{ height: 120 }} /></div>
        ) : (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
            {columns.map((c) => {
              const isPool = c.kind === 'pool';
              const items = poolByCol.get(c.key) ?? [];
              const occupants = c.room ? (occupantsByRoom.get(c.key) ?? []) : [];
              const active = dragOverCol === c.key;
              return (
                <div
                  key={c.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCol(c.key); }}
                  onDragLeave={() => setDragOverCol((k) => (k === c.key ? null : k))}
                  onDrop={() => onDropCol(c.key)}
                  style={{
                    flex: '0 0 240px', minWidth: 240, borderRadius: 'var(--radius-md, 10px)',
                    border: `1.5px ${active ? 'dashed' : 'solid'} ${active ? 'var(--skdw-purple)' : 'var(--skdw-border)'}`,
                    background: active ? 'var(--skdw-purple-pale)' : (isPool ? 'var(--skdw-bg)' : 'var(--skdw-white)'),
                    transition: 'background var(--transition-fast), border-color var(--transition-fast)',
                  }}
                >
                  <div className="row-between" style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--skdw-border)' }}>
                    <strong style={{ fontSize: 14 }}>{c.label}</strong>
                    <span className={`badge ${isPool ? 'badge-muted' : 'badge-purple'}`}>
                      {isPool ? items.length : occupants.length + items.length}
                    </span>
                  </div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 60 }}>
                    {/* Existing occupants (context only). */}
                    {occupants.map((r) => (
                      <div key={`occ-${r.enrollmentId}`} title="อยู่ในห้องนี้แล้ว"
                        style={{ borderRadius: 8, padding: '6px 9px', border: '1px dashed var(--skdw-border)',
                          background: 'var(--skdw-bg)', opacity: 0.75 }}>
                        <div className="row" style={{ gap: 6, justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 13 }}>{fullName(r)}</span>
                          <span className="mono muted" style={{ fontSize: 11 }}>{r.studentCode}</span>
                        </div>
                      </div>
                    ))}
                    {/* Pooled (placeable) cards. */}
                    {isPool && items.length === 0 && (
                      <div className="muted" style={{ fontSize: 12, textAlign: 'center', padding: '14px 4px' }}>
                        เพิ่มนักเรียนจากด้านบนเข้ากองนี้
                      </div>
                    )}
                    {!isPool && items.length === 0 && occupants.length === 0 && (
                      <div className="muted" style={{ fontSize: 12, textAlign: 'center', padding: '14px 4px' }}>
                        ลากนักเรียนมาที่นี่
                      </div>
                    )}
                    {items.map((p) => {
                      const picked = sel.has(p.key);
                      return (
                        <div
                          key={p.key}
                          draggable
                          onDragStart={(e) => onDragStart(p.key, e)}
                          onClick={() => toggleSel(p.key)}
                          title="คลิกเพื่อเลือก • ลากเพื่อย้าย"
                          style={{
                            cursor: 'grab', userSelect: 'none', borderRadius: 8, padding: '7px 9px',
                            border: `1.5px solid ${picked ? 'var(--skdw-purple)' : 'var(--skdw-border)'}`,
                            background: picked ? 'var(--skdw-purple-pale)' : 'var(--skdw-white)',
                          }}
                        >
                          <div className="row" style={{ gap: 6, alignItems: 'baseline', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</span>
                            <span className="mono" style={{ fontSize: 11, color: 'var(--skdw-muted)' }}>{p.studentCode}</span>
                          </div>
                          <div className="row-between" style={{ marginTop: 1 }}>
                            <span className="muted" style={{ fontSize: 11 }}>
                              {p.gender ?? '-'}
                              {p.context && <span> • {p.context}</span>}
                              {p.kind === 'new' && <span style={{ color: 'var(--skdw-purple)' }}> • ใหม่</span>}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeFromPool(p.key); }}
                              style={{ fontSize: 11, background: 'none', border: 'none', padding: 0,
                                color: 'var(--skdw-muted)', cursor: 'pointer', textDecoration: 'underline' }}>
                              เอาออก
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Options + submit */}
      {grade && (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={renumber} onChange={(e) => setRenumber(e.target.checked)} />
              <span>รันเลขที่ใหม่ 1..N ทุกห้องในชั้นนี้ <span className="muted">(ไม่เลือก = คงเลขที่เดิม)</span></span>
            </label>
            <div className="spacer" style={{ flex: 1 }} />
            <span className="muted">จัดเข้าห้อง {placedItems.length} คน{poolCount ? ` • รอจัด ${poolCount}` : ''}</span>
            <button className="btn btn-primary" onClick={submit} disabled={busy || !placedItems.length}>
              {busy ? 'กำลังบันทึก…' : `จัดเข้าห้อง ${placedItems.length} คน`}
            </button>
          </div>
        </div>
      )}

      {importOpen && yearId && (
        <PlacementImportDialog
          yearId={yearId}
          yearLabel={year ?? yearId}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); loadRoster(); }}
        />
      )}
    </div>
  );
}

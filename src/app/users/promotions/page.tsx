'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { nextGrade, isKeyStageBoundary, keyStageOf, KEY_STAGE_LABEL_TH, GRADE_ORDER } from '@/lib/grades';

/**
 * เลื่อนชั้น / ขึ้นปีการศึกษา — hybrid board.
 *
 * Workflow assumption: most students promote to the next grade in the SAME room,
 * so on load every studying student is pre-placed into a column named after
 * their current room (target room = same room). Doing nothing then submitting =
 * "promote the whole grade, same rooms". Exceptions are handled by dragging (or
 * multi-selecting + moving) students between room columns, or into the special
 * "ไม่เลื่อนชั้น" column which holds them back / repeats the year.
 *
 * The server payload + /api/users/promotions are unchanged: we still send
 * { studentId, fromGrade, targetGrade, targetClassroom } per promoted student.
 */

interface YearOpt { id: number; year: number; isActive: boolean }
interface Meta { years: YearOpt[]; grades: string[]; classrooms: string[] }
interface RosterRow {
  enrollmentId: number; studentId: number; studentCode: string;
  prefix: string | null; firstName: string; lastName: string;
  gender: string | null; status: string;
  gradeLevel: string | null; classroom: string | null; classNumber: string | null;
}

// A column key is one of: `room:<name>`, 'none' (no room), 'hold' (repeat the
// year), or 'graduate' (จบการศึกษา — finished the stage and leaves, only offered
// when the promotion crosses a ช่วงชั้น boundary).
type ColKind = 'room' | 'none' | 'hold' | 'graduate';
interface Column { key: string; label: string; room: string | null; kind: ColKind }

const HOLD = 'hold';
const NONE = 'none';
const GRAD = 'graduate';
const roomKey = (name: string) => `room:${name}`;

const STATUS_LABEL: Record<string, string> = {
  studying: 'กำลังศึกษา', withdrawn: 'จำหน่าย/ลาออก', graduated: 'จบการศึกษา',
};

const fullName = (r: { prefix: string | null; firstName: string; lastName: string }) =>
  `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim();

/** Numeric-aware room sort so "10" comes after "2". */
const byRoom = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });

export default function PromotionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  // 'year' = ขึ้นปีการศึกษา (new next-year enrollment); 'room' = ย้ายห้องในปีเดิม.
  const [mode, setMode] = useState<'year' | 'room'>('year');
  const [meta, setMeta] = useState<Meta>({ years: [], grades: [], classrooms: [] });
  const [sourceYearId, setSourceYearId] = useState<number | ''>('');
  const [targetYearId, setTargetYearId] = useState<number | ''>('');
  const [grade, setGrade] = useState('');
  const [targetGrade, setTargetGrade] = useState('');
  const [rows, setRows] = useState<RosterRow[]>([]);

  // enrollmentId -> column key. Source of truth for where each student lands.
  const [assign, setAssign] = useState<Record<number, string>>({});
  const [extraRooms, setExtraRooms] = useState<string[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [newRoom, setNewRoom] = useState('');

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recordCompletion, setRecordCompletion] = useState(true);
  const [renumber, setRenumber] = useState(true);
  // Exit metadata for the "จบการศึกษา (ไม่เรียนต่อ)" bucket at a stage boundary.
  const [exitDate, setExitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exitReason, setExitReason] = useState('จบการศึกษา (ไม่ศึกษาต่อ)');

  // ids being dragged right now (the selection, or the single card if unselected).
  const dragIds = useRef<number[]>([]);

  // Load meta once; default source = active year, target = next year if present.
  useEffect(() => {
    api<Meta>('/api/users/meta').then((m) => {
      setMeta(m);
      const active = m.years.find((y) => y.isActive) ?? m.years[m.years.length - 1];
      if (active) {
        setSourceYearId(active.id);
        const next = m.years.find((y) => y.year === active.year + 1);
        if (next) setTargetYearId(next.id);
      }
    }).catch(() => {});
  }, []);

  // Default the target grade to "the next grade" whenever the source grade changes.
  useEffect(() => { setTargetGrade(nextGrade(grade) ?? ''); }, [grade]);

  const loadRoster = useCallback(async () => {
    if (!sourceYearId || !grade) { setRows([]); setAssign({}); setExtraRooms([]); setSel(new Set()); return; }
    setLoading(true);
    try {
      // Load the whole grade (all rooms) so every destination column is visible.
      const sp = new URLSearchParams({ yearId: String(sourceYearId), grade });
      const res = await api<{ data: RosterRow[] }>(`/api/users/enrollments?${sp}`);
      setRows(res.data);
      // Default placement: everyone starts in their current room. In year mode,
      // non-studying students are parked in the "hold" bin instead.
      const a: Record<number, string> = {};
      for (const r of res.data) {
        if (mode === 'year' && r.status !== 'studying') a[r.enrollmentId] = HOLD;
        else if (r.classroom) a[r.enrollmentId] = roomKey(r.classroom);
        else a[r.enrollmentId] = NONE;
      }
      setAssign(a);
      setExtraRooms([]);
      setSel(new Set());
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [sourceYearId, grade, mode, toast]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  // ป.6→ม.1 style transition: finishing a ช่วงชั้น. Only then does "จบการศึกษา
  // (ไม่เรียนต่อ)" make sense — a leaver here graduated, they did NOT withdraw.
  const boundary = isKeyStageBoundary(grade, targetGrade);

  // If the target grade stops being a stage boundary, the graduate bin vanishes;
  // return anyone parked there to their current room so they aren't lost.
  useEffect(() => {
    if (boundary) return;
    setAssign((a) => {
      let changed = false;
      const n = { ...a };
      for (const r of rows) {
        if (n[r.enrollmentId] === GRAD) {
          n[r.enrollmentId] = r.classroom ? roomKey(r.classroom) : NONE;
          changed = true;
        }
      }
      return changed ? n : a;
    });
  }, [boundary, rows]);

  // Build the ordered column list: real rooms, then "no room", then the hold bin.
  const columns = useMemo<Column[]>(() => {
    const roomSet = new Set<string>();
    for (const r of rows) if (r.classroom) roomSet.add(r.classroom);
    for (const r of extraRooms) roomSet.add(r);
    const cols: Column[] = [...roomSet].sort(byRoom).map((name) => ({
      key: roomKey(name), label: `ห้อง ${name}`, room: name, kind: 'room' as const,
    }));
    const hasNone = rows.some((r) => !r.classroom) || Object.values(assign).includes(NONE);
    if (hasNone) cols.push({ key: NONE, label: 'ไม่ระบุห้อง', room: null, kind: 'none' });
    // จบการศึกษา bin: only at a stage boundary (finished ป.6 / ม.3 / ม.6 and leaves).
    if (mode === 'year' && boundary) cols.push({ key: GRAD, label: 'จบการศึกษา (ไม่เรียนต่อ)', room: null, kind: 'graduate' });
    // The "hold / repeat the year" bin only makes sense when promoting a year.
    if (mode === 'year') cols.push({ key: HOLD, label: 'ไม่เลื่อนชั้น / ซ้ำชั้น', room: null, kind: 'hold' });
    return cols;
  }, [rows, extraRooms, assign, mode, boundary]);

  const rowsByCol = useMemo(() => {
    const m = new Map<string, RosterRow[]>();
    for (const c of columns) m.set(c.key, []);
    for (const r of rows) {
      const k = assign[r.enrollmentId] ?? NONE;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  }, [rows, assign, columns]);

  // The cohort splits three ways in year mode: promote (→ next-year enrollment),
  // graduate (finished the stage, leaves), and hold (repeat the year).
  const graduateRows = useMemo(
    () => (mode === 'year' && boundary ? rows.filter((r) => assign[r.enrollmentId] === GRAD) : []),
    [mode, boundary, rows, assign],
  );
  const promotedRows = useMemo(
    () => rows.filter((r) => { const k = assign[r.enrollmentId]; return k !== HOLD && k !== GRAD; }),
    [rows, assign],
  );
  const promoteCount = promotedRows.length;
  const graduateCount = graduateRows.length;
  const holdCount = rows.filter((r) => assign[r.enrollmentId] === HOLD).length;

  // Room mode: the students whose target room differs from their current room.
  const movedRows = useMemo(() => {
    if (mode !== 'room') return [];
    return rows.filter((r) => {
      const cur = r.classroom ? roomKey(r.classroom) : NONE;
      return (assign[r.enrollmentId] ?? NONE) !== cur;
    });
  }, [mode, rows, assign]);

  // Switching mode reloads the board; renumber defaults on for promotion, off for
  // a same-year room move (a lone move usually should not renumber whole rooms).
  const switchMode = (m: 'year' | 'room') => {
    if (m === mode) return;
    setMode(m);
    setRenumber(m === 'year');
    setSel(new Set());
  };

  const sourceYear = meta.years.find((y) => y.id === sourceYearId)?.year;
  const targetYear = meta.years.find((y) => y.id === targetYearId)?.year;

  // -- selection --
  const toggleSel = (id: number) =>
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSel(new Set());

  // -- move (shared by drag-drop and the toolbar select) --
  const moveTo = useCallback((ids: number[], colKey: string) => {
    if (!ids.length) return;
    setAssign((a) => { const n = { ...a }; for (const id of ids) n[id] = colKey; return n; });
  }, []);

  const onDragStart = (id: number, e: React.DragEvent) => {
    // Drag the whole selection if the grabbed card is part of it; else just it.
    dragIds.current = sel.has(id) ? [...sel] : [id];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
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
    if (!extraRooms.includes(name) && !rows.some((r) => r.classroom === name)) {
      setExtraRooms((r) => [...r, name]);
    }
    setNewRoom('');
  };

  async function submitRoomMove() {
    if (!sourceYearId) return toast('เลือกปีการศึกษา', 'error');
    if (!movedRows.length) return toast('ยังไม่มีนักเรียนที่ย้ายห้อง (ลากการ์ดไปคอลัมน์ห้องอื่น)', 'error');

    const colOf = (k: string) => columns.find((c) => c.key === k);
    const summary = movedRows
      .map((r) => `${fullName(r)}: ห้อง ${r.classroom ?? '-'} → ${colOf(assign[r.enrollmentId])?.room ?? '-'}`)
      .slice(0, 8)
      .join('\n');

    if (!(await confirm({
      title: 'ยืนยันการย้ายห้อง',
      message:
        `ย้าย ${movedRows.length} คน ภายในปี ${sourceYear} (ชั้น ${grade})\n${summary}` +
        (movedRows.length > 8 ? `\n…และอีก ${movedRows.length - 8} คน` : '') +
        (renumber ? '\nและรันเลขที่ใหม่ทุกห้องในชั้นนี้' : ''),
      confirmText: `ย้าย ${movedRows.length} คน`,
    }))) return;

    setBusy(true);
    try {
      const items = movedRows.map((r) => ({
        enrollmentId: r.enrollmentId,
        targetClassroom: colOf(assign[r.enrollmentId])?.room ?? null,
      }));
      const res = await api<{ moved: number }>(
        '/api/users/room-transfers',
        jsonBody({ yearId: sourceYearId, grade, renumber, items }),
      );
      toast(`ย้ายห้อง ${res.moved} คนสำเร็จ`, 'success');
      loadRoster();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!sourceYearId) return toast('เลือกปีการศึกษา', 'error');
    if (!promoteCount && !graduateCount) return toast('ยังไม่มีนักเรียนที่จะเลื่อนหรือจบการศึกษา', 'error');
    if (promoteCount) {
      if (!targetYearId) return toast('เลือกปีปลายทาง', 'error');
      if (sourceYearId === targetYearId) return toast('ปีต้นทางและปลายทางต้องต่างกัน', 'error');
      if (!targetGrade.trim()) return toast('ยังไม่ได้กำหนดชั้นปลายทาง', 'error');
    }
    if (graduateCount && (!exitDate.trim() || !exitReason.trim())) {
      return toast('กรุณาระบุวันที่และเหตุผลของกลุ่มจบการศึกษา', 'error');
    }

    const stageLabel = boundary ? KEY_STAGE_LABEL_TH[keyStageOf(grade)!] : '';
    const message = [
      promoteCount ? `เลื่อน ${promoteCount} คน จาก ${grade} (ปี ${sourceYear}) → ${targetGrade} (ปี ${targetYear})` : null,
      graduateCount ? `จบการศึกษา (ไม่เรียนต่อ) ${graduateCount} คน — ${exitDate}` : null,
      holdCount ? `คงไว้/ไม่เลื่อน ${holdCount} คน` : null,
      recordCompletion && boundary ? `บันทึกจบ${stageLabel}ให้ ${promoteCount + graduateCount} คน` : null,
      renumber && promoteCount ? 'รันเลขที่ใหม่ในห้องปลายทาง' : null,
    ].filter(Boolean).join('\n');

    if (!(await confirm({ title: 'ยืนยันการเลื่อนชั้น / จบการศึกษา', message, confirmText: 'ยืนยัน' }))) return;

    setBusy(true);
    try {
      // 1) Graduate the leavers first — status change + จบช่วงชั้น, no next-year enrollment.
      let gradResult = { updated: 0, completionsRecorded: 0 };
      if (graduateCount) {
        gradResult = await api<{ updated: number; completionsRecorded: number }>(
          '/api/users/graduations',
          jsonBody({
            academicYearId: sourceYearId,
            studentIds: graduateRows.map((r) => r.studentId),
            exitType: 'จบการศึกษา',
            exitReason,
            exitDate,
            recordCompletion,
          }),
        );
      }
      // 2) Promote the continuing students into the next year.
      let promoteResult = { promoted: 0, completionsRecorded: 0 };
      if (promoteCount) {
        const colOf = (k: string) => columns.find((c) => c.key === k);
        const items = promotedRows.map((r) => ({
          studentId: r.studentId,
          fromGrade: r.gradeLevel,
          targetGrade,
          targetClassroom: colOf(assign[r.enrollmentId])?.room ?? null,
        }));
        promoteResult = await api<{ promoted: number; completionsRecorded: number }>(
          '/api/users/promotions',
          jsonBody({ sourceYearId, targetYearId, recordCompletion, renumber, items }),
        );
      }

      const parts: string[] = [];
      if (promoteResult.promoted) parts.push(`เลื่อนชั้น ${promoteResult.promoted} คน`);
      if (gradResult.updated) parts.push(`จบการศึกษา ${gradResult.updated} คน`);
      const completions = promoteResult.completionsRecorded + gradResult.completionsRecorded;
      toast(
        `${parts.join(' • ') || 'สำเร็จ'}${completions ? ` (บันทึกจบช่วงชั้น ${completions} คน)` : ''}`,
        'success',
      );
      loadRoster();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="page-title">เลื่อนชั้น / ย้ายห้อง</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          {mode === 'year'
            ? 'ทุกคนเริ่มต้นอยู่ “ห้องเดิม” — ไม่ต้องแก้อะไรก็กดเลื่อนทั้งชั้นได้เลย. ถ้าจะจัดห้องใหม่ให้ลากการ์ดนักเรียนข้ามคอลัมน์ (คลิกเลือกหลายคนแล้วลากพร้อมกันได้) หรือลากไปคอลัมน์ “ไม่เลื่อนชั้น” เพื่อคงไว้/ซ้ำชั้น.'
            : 'ย้ายนักเรียนไปห้องอื่นภายในปีเดิม (ชั้นเดิม). ลากการ์ดคนที่ต้องการไปคอลัมน์ห้องปลายทาง — จะย้ายเฉพาะคนที่ลากเท่านั้น. เหมาะกับการย้ายทีละคน.'}
        </p>
      </div>

      {/* Mode switch */}
      <div className="row" style={{ gap: 8 }}>
        <button
          className={`btn btn-sm ${mode === 'year' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => switchMode('year')}
        >
          เลื่อนขึ้นปี
        </button>
        <button
          className={`btn btn-sm ${mode === 'room' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => switchMode('room')}
        >
          ย้ายห้อง (ปีเดียวกัน)
        </button>
      </div>

      {/* Year + grade controls */}
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">{mode === 'year' ? 'ปีต้นทาง' : 'ปีการศึกษา'}</label>
            <select className="form-select" style={{ width: 140 }} value={sourceYearId}
              onChange={(e) => setSourceYearId(Number(e.target.value))}>
              {meta.years.map((y) => <option key={y.id} value={y.id}>{y.year}{y.isActive ? ' (ปัจจุบัน)' : ''}</option>)}
            </select>
          </div>
          {mode === 'year' && (
            <>
              <div style={{ alignSelf: 'center', paddingBottom: 8, color: 'var(--skdw-muted)' }}>→</div>
              <div>
                <label className="form-label">ปีปลายทาง</label>
                <select className="form-select" style={{ width: 140 }} value={targetYearId}
                  onChange={(e) => setTargetYearId(Number(e.target.value))}>
                  <option value="">— เลือกปี —</option>
                  {meta.years.map((y) => <option key={y.id} value={y.id}>{y.year}</option>)}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="form-label">ชั้น{mode === 'year' ? ' (ต้นทาง)' : ''}</label>
            <select className="form-select" style={{ width: 150 }} value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">— เลือกชั้น —</option>
              {meta.grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          {mode === 'year' && (
            <div>
              <label className="form-label">→ ชั้นปลายทาง</label>
              <input list="promo-grades" className="form-input" style={{ width: 130 }} value={targetGrade}
                onChange={(e) => setTargetGrade(e.target.value)} placeholder="ชั้นปลายทาง" />
              <datalist id="promo-grades">{GRADE_ORDER.map((g) => <option key={g} value={g} />)}</datalist>
            </div>
          )}
        </div>
        {mode === 'year' && grade && boundary && (
          <p className="muted" style={{ marginTop: 10, fontSize: 13, color: 'var(--skdw-purple)' }}>
            {grade} → {targetGrade} ข้ามช่วงชั้น — ระบบจะบันทึก “จบ{KEY_STAGE_LABEL_TH[keyStageOf(grade)!]}” ให้ผู้ที่เลื่อน (ไม่ถือเป็นการจำหน่าย).
            เด็กที่ “จบแล้วไม่เรียนต่อ” ให้ลากไปคอลัมน์ <strong>จบการศึกษา (ไม่เรียนต่อ)</strong> — จะบันทึกเป็นจบการศึกษา ไม่ใช่ลาออก.
          </p>
        )}
        {mode === 'year' && !targetYearId && (
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            ยังไม่มีปีปลายทาง — ไปสร้างที่หน้า <a href="/users/academic-years" style={{ color: 'var(--skdw-purple)', textDecoration: 'underline' }}>ปีการศึกษา</a> ก่อน
          </p>
        )}
      </div>

      {/* Toolbar: summary + selection actions + add room */}
      {grade && (
        <div className="card" style={{ padding: 12 }}>
          <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {mode === 'year' ? (
                <>
                  <span className="badge badge-purple">เลื่อน {promoteCount}</span>
                  {graduateCount > 0 && <span className="badge badge-warning">จบการศึกษา {graduateCount}</span>}
                  {holdCount > 0 && <span className="badge badge-muted">คงไว้ {holdCount}</span>}
                </>
              ) : (
                <span className="badge badge-purple">ย้ายห้อง {movedRows.length}</span>
              )}
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
              <input className="form-input" style={{ width: 130 }} placeholder="ชื่อห้องใหม่ เช่น 4"
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
        ) : rows.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <span className="muted">ไม่พบนักเรียนในชั้นนี้</span>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
            {columns.map((c) => {
              const list = rowsByCol.get(c.key) ?? [];
              const isHold = c.kind === HOLD;
              const isGrad = c.kind === 'graduate';
              const active = dragOverCol === c.key;
              return (
                <div
                  key={c.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCol(c.key); }}
                  onDragLeave={() => setDragOverCol((k) => (k === c.key ? null : k))}
                  onDrop={() => onDropCol(c.key)}
                  style={{
                    flex: '0 0 240px', minWidth: 240, borderRadius: 'var(--radius-md, 10px)',
                    border: `1.5px ${active ? 'dashed' : 'solid'} ${active ? 'var(--skdw-purple)' : (isGrad ? 'var(--color-warning)' : 'var(--skdw-border)')}`,
                    background: active ? 'var(--skdw-purple-pale)' : (isHold ? 'var(--skdw-bg)' : (isGrad ? 'var(--color-warning-bg)' : 'var(--skdw-white)')),
                    transition: 'background var(--transition-fast), border-color var(--transition-fast)',
                  }}
                >
                  <div className="row-between" style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--skdw-border)' }}>
                    <strong style={{ fontSize: 14, color: isHold ? 'var(--skdw-muted)' : (isGrad ? 'var(--color-warning)' : 'inherit') }}>{c.label}</strong>
                    <span className={`badge ${isHold ? 'badge-muted' : (isGrad ? 'badge-warning' : 'badge-purple')}`}>{list.length}</span>
                  </div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 60 }}>
                    {list.length === 0 && (
                      <div className="muted" style={{ fontSize: 12, textAlign: 'center', padding: '14px 4px' }}>
                        ลากนักเรียนมาที่นี่
                      </div>
                    )}
                    {list.map((r) => {
                      const picked = sel.has(r.enrollmentId);
                      const exited = r.status !== 'studying';
                      return (
                        <div
                          key={r.enrollmentId}
                          draggable
                          onDragStart={(e) => onDragStart(r.enrollmentId, e)}
                          onClick={() => toggleSel(r.enrollmentId)}
                          title={exited ? STATUS_LABEL[r.status] : 'คลิกเพื่อเลือก • ลากเพื่อย้ายห้อง'}
                          style={{
                            cursor: 'grab', userSelect: 'none', borderRadius: 8, padding: '7px 9px',
                            border: `1.5px solid ${picked ? 'var(--skdw-purple)' : 'var(--skdw-border)'}`,
                            background: picked ? 'var(--skdw-purple-pale)' : 'var(--skdw-white)',
                            opacity: isHold ? 0.7 : 1,
                          }}
                        >
                          <div className="row" style={{ gap: 6, alignItems: 'baseline', justifyContent: 'space-between' }}>
                            <span className="row" style={{ gap: 6, alignItems: 'baseline', minWidth: 0 }}>
                              <span className="mono" title="เลขที่"
                                style={{ fontSize: 11, fontWeight: 600, color: 'var(--skdw-purple)', minWidth: 16, textAlign: 'right', flexShrink: 0 }}>
                                {r.classNumber ?? '-'}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{fullName(r)}</span>
                            </span>
                            <span className="mono" style={{ fontSize: 11, color: 'var(--skdw-muted)' }}>{r.studentCode}</span>
                          </div>
                          <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
                            {r.gender ?? '-'}
                            {r.classroom ? ` • เดิมห้อง ${r.classroom}` : ''}
                            {exited && ` • ${STATUS_LABEL[r.status] ?? r.status}`}
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
      {grade && rows.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          {mode === 'year' ? (
            <div className="stack" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                <label className="row" style={{ gap: 8, cursor: 'pointer', opacity: boundary ? 1 : 0.5 }}>
                  <input type="checkbox" checked={recordCompletion} disabled={!boundary}
                    onChange={(e) => setRecordCompletion(e.target.checked)} />
                  <span>บันทึก “จบช่วงชั้น” ให้ผู้ที่ข้ามช่วงชั้น {boundary && <span className="muted">({promoteCount + graduateCount} คน)</span>}</span>
                </label>
                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={renumber} onChange={(e) => setRenumber(e.target.checked)} />
                  <span>รันเลขที่ใหม่ 1..N ในห้องปลายทาง</span>
                </label>
                <div className="spacer" style={{ flex: 1 }} />
                <span className="muted">เลื่อน {promoteCount} คน{graduateCount ? ` • จบ ${graduateCount}` : ''}{holdCount ? ` • คงไว้ ${holdCount}` : ''}</span>
                <button className="btn btn-primary" onClick={submit}
                  disabled={busy || (promoteCount > 0 && !targetYearId) || (!promoteCount && !graduateCount)}>
                  {busy ? 'กำลังบันทึก…'
                    : promoteCount && graduateCount ? 'เลื่อนชั้น + จบการศึกษา'
                    : graduateCount ? `จบการศึกษา ${graduateCount} คน`
                    : `เลื่อนชั้น → ${targetYear ?? ''}`}
                </button>
              </div>
              {graduateCount > 0 && (
                <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end',
                  borderTop: '0.5px solid var(--skdw-border)', paddingTop: 12 }}>
                  <span className="badge badge-warning" style={{ alignSelf: 'center' }}>จบการศึกษา {graduateCount} คน</span>
                  <div>
                    <label className="form-label">วันที่จบการศึกษา</label>
                    <input type="date" className="form-input" style={{ width: 160 }}
                      value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label className="form-label">เหตุผล</label>
                    <input className="form-input" style={{ width: '100%' }}
                      value={exitReason} onChange={(e) => setExitReason(e.target.value)}
                      placeholder="เช่น จบการศึกษา (ไม่ศึกษาต่อ)" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={renumber} onChange={(e) => setRenumber(e.target.checked)} />
                <span>รันเลขที่ใหม่ 1..N ทุกห้องในชั้นนี้ <span className="muted">(ไม่เลือก = คงเลขที่เดิม)</span></span>
              </label>
              <div className="spacer" style={{ flex: 1 }} />
              <span className="muted">ย้าย {movedRows.length} คน</span>
              <button className="btn btn-primary" onClick={submitRoomMove} disabled={busy || !movedRows.length}>
                {busy ? 'กำลังย้ายห้อง…' : `ย้ายห้อง ${movedRows.length} คน`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

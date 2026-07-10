'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { keyStageOf, KEY_STAGE_LABEL_TH } from '@/lib/grades';
import { IconChevron, IconRestore } from './Icons';

/**
 * จบการศึกษา (graduation) — batch tool. Pick a year + grade (defaults to the top
 * grade present, e.g. ม.6), optionally a room, load the roster, check students,
 * then graduate the whole cohort at once. Below: history grouped into "ชุด"
 * (batches keyed by exit year + date) — each collapsed, click to see who.
 */

interface YearOpt { id: number; year: number; isActive: boolean }
interface Meta { years: YearOpt[]; grades: string[]; classrooms: string[] }
interface RosterRow {
  enrollmentId: number; studentId: number; studentCode: string;
  prefix: string | null; firstName: string; lastName: string;
  gender: string | null; status: string;
  gradeLevel: string | null; classroom: string | null;
}
interface HistoryRow {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; gender: string | null;
  exitType: string | null; exitReason: string | null; exitDate: string | null;
  exitYear: number | null; gradeLevel: string | null; classroom: string | null;
}

export function GraduationTool() {
  const toast = useToast();
  const confirm = useConfirm();
  const endpoint = '/api/users/graduations';

  const [meta, setMeta] = useState<Meta>({ years: [], grades: [], classrooms: [] });
  const [yearId, setYearId] = useState<number | ''>('');
  const [grade, setGrade] = useState('');
  const [room, setRoom] = useState('');
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [exitType, setExitType] = useState('จบการศึกษา');
  const [exitDate, setExitDate] = useState('');
  const [exitReason, setExitReason] = useState('สำเร็จการศึกษา');
  const [recordCompletion, setRecordCompletion] = useState(true);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [revertingBatch, setRevertingBatch] = useState<string | null>(null);

  // Meta once; default to active year and the top grade present (e.g. ม.6).
  useEffect(() => {
    api<Meta>('/api/users/meta').then((m) => {
      setMeta(m);
      const active = m.years.find((y) => y.isActive) ?? m.years[m.years.length - 1];
      if (active) setYearId(active.id);
      if (m.grades.length) setGrade(m.grades[m.grades.length - 1]);
    }).catch(() => {});
  }, []);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await api<{ data: HistoryRow[] }>(endpoint);
      setHistory(res.data);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setHistLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const loadRoster = useCallback(async () => {
    if (!yearId || !grade) { setRows([]); setSel({}); return; }
    setLoading(true);
    try {
      const sp = new URLSearchParams({ yearId: String(yearId), grade });
      if (room) sp.set('classroom', room);
      const res = await api<{ data: RosterRow[] }>(`/api/users/enrollments?${sp}`);
      setRows(res.data);
      // Default select only students still studying (skip already-exited).
      const s: Record<number, boolean> = {};
      for (const r of res.data) s[r.studentId] = r.status === 'studying';
      setSel(s);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [yearId, grade, room, toast]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  const setAll = (v: boolean) =>
    setSel(Object.fromEntries(rows.map((r) => [r.studentId, v && r.status === 'studying'])));

  const selectedIds = useMemo(
    () => rows.filter((r) => sel[r.studentId]).map((r) => r.studentId),
    [rows, sel],
  );
  const stage = keyStageOf(grade);
  const year = meta.years.find((y) => y.id === yearId)?.year;

  async function submit() {
    if (!yearId) return toast('เลือกปีการศึกษา', 'error');
    if (!selectedIds.length) return toast('ยังไม่ได้เลือกนักเรียน', 'error');
    if (!exitDate.trim()) return toast('ระบุวันที่จบการศึกษา', 'error');
    if (!exitReason.trim()) return toast('ระบุเหตุผล', 'error');

    if (!(await confirm({
      title: 'ยืนยันการจบการศึกษา',
      message:
        `ทำจบการศึกษาให้ ${selectedIds.length} คน (ชั้น ${grade} ปี ${year})` +
        (recordCompletion && stage ? `\nและบันทึก “จบ${KEY_STAGE_LABEL_TH[stage]}”` : ''),
      confirmText: `ทำจบการศึกษา ${selectedIds.length} คน`,
    }))) return;

    setBusy(true);
    try {
      const res = await api<{ updated: number; completionsRecorded: number }>(
        endpoint,
        jsonBody({
          academicYearId: yearId,
          studentIds: selectedIds,
          exitType,
          exitDate,
          exitReason,
          recordCompletion,
        }),
      );
      toast(
        `จบการศึกษา ${res.updated} คนสำเร็จ${res.completionsRecorded ? ` (บันทึกจบช่วงชั้น ${res.completionsRecorded} คน)` : ''}`,
        'success',
      );
      loadRoster();
      loadHistory();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // Revert a whole batch (ชุด) — reinstate every student in it to กำลังศึกษา.
  async function revertBatch(b: { key: string; year: number | null; date: string | null; list: HistoryRow[] }) {
    const ids = b.list.map((h) => h.id);
    if (!(await confirm({
      title: 'ย้อนกลับการจบการศึกษา',
      message:
        `คืนสถานะ “กำลังศึกษา” ให้นักเรียนทั้ง ${ids.length} คนในชุดนี้ ` +
        `(ปีการศึกษา ${b.year ?? 'ไม่ระบุ'}${b.date ? ` วันที่ ${b.date}` : ''})\n` +
        'ข้อมูลการจบ (วันที่/เหตุผล) จะถูกล้าง',
      confirmText: `ย้อนกลับทั้งชุด ${ids.length} คน`,
      danger: true,
    }))) return;

    setRevertingBatch(b.key);
    try {
      const res = await api<{ updated: number }>(endpoint, {
        method: 'DELETE',
        body: JSON.stringify({ studentIds: ids }),
      });
      toast(`ย้อนกลับ ${res.updated} คนสำเร็จ`, 'success');
      loadRoster();
      loadHistory();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRevertingBatch(null);
    }
  }

  // Group history into batches: one per (exit year + exit date). Newest first.
  const batches = useMemo(() => {
    const m = new Map<string, HistoryRow[]>();
    for (const h of history) {
      const key = `${h.exitYear ?? '?'}||${h.exitDate ?? '?'}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(h);
    }
    return [...m.entries()]
      .map(([key, list]) => {
        const grades = [...new Set(list.map((r) => r.gradeLevel).filter(Boolean))] as string[];
        return {
          key,
          year: list[0].exitYear,
          date: list[0].exitDate,
          type: list[0].exitType,
          grades,
          list,
        };
      })
      .sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || (b.date ?? '').localeCompare(a.date ?? ''));
  }, [history]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="page-title">จบการศึกษา</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          เลือกปีและชั้น (เช่น ม.6) แล้วเลือกยกทั้งชั้น ทั้งห้อง หรือรายคน เพื่อทำจบการศึกษาพร้อมกัน — ระบบเก็บประวัติเป็นชุดว่าปีใดจบใครบ้าง.
        </p>
      </div>

      {/* Scope */}
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
            <select className="form-select" style={{ width: 150 }} value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">— เลือกชั้น —</option>
              {meta.grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">ห้อง (ไม่บังคับ)</label>
            <select className="form-select" style={{ width: 130 }} value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">ทุกห้อง</option>
              {meta.classrooms.map((c) => <option key={c} value={c}>ห้อง {c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Roster */}
      {grade && (
        <div className="card" style={{ padding: 0 }}>
          <div className="row-between" style={{ padding: 16, flexWrap: 'wrap', gap: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>เลือกทั้งหมด</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAll(false)}>ไม่เลือก</button>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>เลือก {selectedIds.length} คน</span>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>เพศ</th><th>ชั้น/ห้อง</th><th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6}><div className="skeleton" style={{ height: 20 }} /></td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>ไม่พบนักเรียน</td></tr>
                )}
                {rows.map((r) => {
                  const exited = r.status !== 'studying';
                  return (
                    <tr key={r.studentId} style={{ opacity: sel[r.studentId] ? 1 : 0.55 }}>
                      <td>
                        <input type="checkbox" checked={!!sel[r.studentId]}
                          onChange={(e) => setSel((s) => ({ ...s, [r.studentId]: e.target.checked }))} />
                      </td>
                      <td className="mono">{r.studentCode}</td>
                      <td>{r.prefix ?? ''}{r.firstName} {r.lastName}</td>
                      <td>{r.gender ?? '-'}</td>
                      <td>{r.gradeLevel ?? '-'} / {r.classroom ?? '-'}</td>
                      <td>
                        {exited
                          ? <span className="badge badge-muted">{r.status === 'graduated' ? 'จบแล้ว' : 'ออกแล้ว'}</span>
                          : <span className="muted" style={{ fontSize: 12 }}>กำลังศึกษา</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Exit fields + submit */}
      {grade && rows.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="form-label">ประเภท</label>
              <input className="form-input" style={{ width: 180 }} value={exitType} onChange={(e) => setExitType(e.target.value)} />
            </div>
            <div>
              <label className="form-label">วันที่จบ (ว/ด/ปพ.ศ.)</label>
              <input className="form-input" style={{ width: 160 }} placeholder="เช่น 31/03/2569"
                value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="form-label">เหตุผล</label>
              <input className="form-input" value={exitReason} onChange={(e) => setExitReason(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ gap: 20, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {stage && (
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={recordCompletion} onChange={(e) => setRecordCompletion(e.target.checked)} />
                <span>บันทึก “จบ{KEY_STAGE_LABEL_TH[stage]}” ({grade})</span>
              </label>
            )}
            <div className="spacer" style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={submit} disabled={busy || !selectedIds.length}>
              {busy ? 'กำลังบันทึก…' : `ทำจบการศึกษา ${selectedIds.length} คน`}
            </button>
          </div>
        </div>
      )}

      {/* History — batches */}
      <div className="stack" style={{ gap: 10 }}>
        <h2 className="page-title" style={{ fontSize: 18 }}>ประวัติการจบการศึกษา</h2>
        {histLoading && <div className="card" style={{ padding: 16 }}><div className="skeleton" style={{ height: 20 }} /></div>}
        {!histLoading && batches.length === 0 && (
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <span className="muted">ยังไม่มีประวัติ</span>
          </div>
        )}
        {!histLoading && batches.map((b) => {
          const open = openBatch === b.key;
          return (
            <div key={b.key} className="card" style={{ padding: 0 }}>
              <div className="row-between" style={{ padding: '14px 16px', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="row"
                  onClick={() => setOpenBatch(open ? null : b.key)}
                  style={{
                    flex: 1, minWidth: 0, border: 'none', background: 'none', cursor: 'pointer',
                    font: 'inherit', textAlign: 'left', color: 'inherit',
                    gap: 12, flexWrap: 'wrap', alignItems: 'baseline',
                  }}
                  aria-expanded={open}
                >
                  <IconChevron
                    width={16} height={16}
                    style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform var(--transition-fast)' }}
                  />
                  <strong>ปีการศึกษา {b.year ?? 'ไม่ระบุ'}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>วันที่ {b.date ?? '-'}</span>
                  {b.grades.length > 0 && (
                    <span className="muted" style={{ fontSize: 13 }}>ชั้น {b.grades.join(', ')}</span>
                  )}
                </button>
                <div className="row" style={{ gap: 10 }}>
                  <span className="badge badge-gold">{b.list.length} คน</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => revertBatch(b)}
                    disabled={revertingBatch === b.key}
                    title="คืนสถานะกำลังศึกษาให้นักเรียนทั้งชุด"
                  >
                    <IconRestore width={14} height={14} />
                    {revertingBatch === b.key ? 'กำลังย้อนกลับ…' : 'ย้อนกลับทั้งชุด'}
                  </button>
                </div>
              </div>
              {open && (
                <div className="table-wrap" style={{ borderTop: '0.5px solid var(--skdw-border)' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ชั้น/ห้อง</th><th>ประเภท</th><th>เหตุผล</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.list.map((h) => (
                        <tr key={h.id}>
                          <td className="mono">
                            <a href={`/users/students/${h.id}`} style={{ color: 'var(--skdw-purple)' }}>{h.studentCode}</a>
                          </td>
                          <td>{h.prefix ?? ''}{h.firstName} {h.lastName}</td>
                          <td>{h.gradeLevel ?? '-'} / {h.classroom ?? '-'}</td>
                          <td>{h.exitType ?? '-'}</td>
                          <td className="muted">{h.exitReason ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

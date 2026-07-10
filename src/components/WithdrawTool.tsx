'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { ReinstateDialog } from './ReinstateDialog';
import { IconSearch, IconPlus, IconRestore } from './Icons';

/**
 * จำหน่าย / ลาออก — individual workflow. Search for a still-studying student,
 * add one or more to a selection, then record the exit (type ลาออก / พักการเรียน /
 * เสียชีวิต …) with a date + reason. Below: a searchable table of everyone
 * currently withdrawn/พักการเรียน — each row can be reinstated (คืนสถานะ) when a
 * student comes back.
 */

interface YearOpt { id: number; year: number; isActive: boolean }
interface Meta { years: YearOpt[] }
interface SearchRow {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; nickname: string | null;
  gender: string | null; gradeLevel: string | null; classroom: string | null;
}
interface Picked {
  id: number; studentCode: string; name: string;
  gradeLevel: string | null; classroom: string | null;
}
interface HistoryRow {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; gender: string | null;
  exitType: string | null; exitReason: string | null; exitDate: string | null;
  exitYear: number | null; gradeLevel: string | null; classroom: string | null;
}

const WITHDRAW_TYPES = ['ลาออก', 'พักการเรียน', 'เสียชีวิต', 'ย้ายสถานศึกษา', 'นักเรียนไปโครงการ', 'จำหน่าย', 'อื่น ๆ'];

const fullName = (r: { prefix: string | null; firstName: string; lastName: string }) =>
  `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim();

/** Parse a raw Thai date "d/m/BBBB" into a sortable YYYYMMDD number (BE year kept). */
function parseThaiDate(s: string | null): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
}

export function WithdrawTool() {
  const toast = useToast();
  const confirm = useConfirm();

  const [years, setYears] = useState<YearOpt[]>([]);
  // Exit year to record for this batch (default = current active year).
  const [exitYearId, setExitYearId] = useState<number | null>(null);

  // -- search + selection --
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const searchSeq = useRef(0);

  // -- exit fields --
  const [exitType, setExitType] = useState('ลาออก');
  const [exitDate, setExitDate] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [busy, setBusy] = useState(false);

  // -- history --
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histQuery, setHistQuery] = useState('');
  const [histYear, setHistYear] = useState<'all' | number>('all');
  const [histFrom, setHistFrom] = useState('');
  const [histTo, setHistTo] = useState('');

  // -- reinstate --
  const [reinstateTarget, setReinstateTarget] = useState<HistoryRow | null>(null);

  useEffect(() => {
    api<Meta>('/api/users/meta').then((m) => {
      setYears(m.years);
      const active = m.years.find((y) => y.isActive) ?? m.years[m.years.length - 1];
      if (active) setExitYearId(active.id);
    }).catch(() => {});
  }, []);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await api<{ data: HistoryRow[] }>('/api/users/withdrawals');
      setHistory(res.data);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setHistLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Debounced search over still-studying students.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ q: term, status: 'studying', pageSize: '20' });
        const res = await api<{ data: SearchRow[] }>(`/api/users/students?${sp}`);
        if (seq === searchSeq.current) setResults(res.data);
      } catch (e) {
        if (seq === searchSeq.current) toast((e as Error).message, 'error');
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, toast]);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);

  function addStudent(r: SearchRow) {
    if (pickedIds.has(r.id)) return;
    setPicked((p) => [...p, {
      id: r.id, studentCode: r.studentCode, name: fullName(r),
      gradeLevel: r.gradeLevel, classroom: r.classroom,
    }]);
  }
  const removeStudent = (id: number) => setPicked((p) => p.filter((x) => x.id !== id));

  async function submit() {
    if (!exitYearId) return toast('ยังไม่พบปีการศึกษา', 'error');
    if (!picked.length) return toast('ยังไม่ได้เลือกนักเรียน', 'error');
    if (!exitDate.trim()) return toast('ระบุวันที่ออก', 'error');
    if (!exitReason.trim()) return toast('ระบุเหตุผล', 'error');

    const exitYearLabel = years.find((y) => y.id === exitYearId)?.year;
    if (!(await confirm({
      title: 'ยืนยันการบันทึก',
      message: `บันทึก “${exitType}” (ปีการศึกษา ${exitYearLabel ?? '-'}) ให้ ${picked.length} คน?`,
      confirmText: `บันทึก ${picked.length} คน`,
      danger: true,
    }))) return;

    setBusy(true);
    try {
      const res = await api<{ updated: number }>('/api/users/withdrawals', jsonBody({
        academicYearId: exitYearId,
        studentIds: picked.map((p) => p.id),
        exitType,
        exitDate,
        exitReason,
      }));
      toast(`บันทึก ${res.updated} คนสำเร็จ`, 'success');
      setPicked([]);
      setQ('');
      setResults([]);
      setExitReason('');
      setExitDate('');
      loadHistory();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // Distinct exit years present in the history, newest first, for the filter.
  const histYearOpts = useMemo(() => {
    const set = new Set<number>();
    for (const h of history) if (h.exitYear != null) set.add(h.exitYear);
    return [...set].sort((a, b) => b - a);
  }, [history]);

  const filteredHistory = useMemo(() => {
    const term = histQuery.trim().toLowerCase();
    const from = parseThaiDate(histFrom);
    const to = parseThaiDate(histTo);
    return history.filter((h) => {
      if (term &&
        !(h.studentCode.toLowerCase().includes(term) ||
          fullName(h).toLowerCase().includes(term) ||
          (h.exitType ?? '').toLowerCase().includes(term))) return false;
      if (histYear !== 'all' && h.exitYear !== histYear) return false;
      if (from != null || to != null) {
        const d = parseThaiDate(h.exitDate);
        if (d == null) return false;
        if (from != null && d < from) return false;
        if (to != null && d > to) return false;
      }
      return true;
    });
  }, [history, histQuery, histYear, histFrom, histTo]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="page-title">จำหน่าย / ลาออก</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          ค้นหาและเลือกนักเรียน แล้วบันทึกการลาออก พักการเรียน หรือเสียชีวิต พร้อมวันที่และเหตุผล — ตารางด้านล่างค้นหาได้ และคืนสถานะได้เมื่อนักเรียนกลับมาเรียน.
        </p>
      </div>

      {/* Search + pick */}
      <div className="card" style={{ padding: 16 }}>
        <label className="form-label">ค้นหานักเรียน (รหัส / ชื่อ / ชื่อเล่น)</label>
        <div style={{ position: 'relative', maxWidth: 420 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--skdw-muted)' }}>
            <IconSearch width={16} height={16} />
          </span>
          <input
            className="form-input"
            style={{ paddingLeft: 34 }}
            placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {q.trim().length >= 2 && (
          <div className="card" style={{ marginTop: 8, padding: 0, maxHeight: 260, overflowY: 'auto' }}>
            {searching && <div className="muted" style={{ padding: 12, fontSize: 13 }}>กำลังค้นหา…</div>}
            {!searching && results.length === 0 && (
              <div className="muted" style={{ padding: 12, fontSize: 13 }}>ไม่พบนักเรียนที่กำลังศึกษา</div>
            )}
            {results.map((r) => {
              const added = pickedIds.has(r.id);
              return (
                <div key={r.id} className="row-between" style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--skdw-border)' }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="mono" style={{ color: 'var(--skdw-muted)' }}>{r.studentCode}</span>
                    <span>{fullName(r)}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{r.gradeLevel ?? '-'}/{r.classroom ?? '-'}</span>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => addStudent(r)} disabled={added}>
                    <IconPlus width={14} height={14} /> {added ? 'เลือกแล้ว' : 'เลือก'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {picked.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>เลือกไว้ {picked.length} คน</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {picked.map((p) => (
                <span key={p.id} className="chip" style={{ gap: 6 }}>
                  {p.studentCode} {p.name}
                  <button
                    onClick={() => removeStudent(p.id)}
                    aria-label="เอาออก"
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 15, lineHeight: 1, padding: 0 }}
                  >×</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Exit fields + submit */}
      {picked.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="form-label">ปีการศึกษาที่ออก</label>
              <select className="form-select" style={{ width: 140 }} value={exitYearId ?? ''} onChange={(e) => setExitYearId(Number(e.target.value))}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.year}{y.isActive ? ' (ปัจจุบัน)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">ประเภท</label>
              <select className="form-select" style={{ width: 160 }} value={exitType} onChange={(e) => setExitType(e.target.value)}>
                {WITHDRAW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">วันที่ (ว/ด/ปพ.ศ.)</label>
              <input className="form-input" style={{ width: 160 }} placeholder="เช่น 31/03/2569"
                value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="form-label">เหตุผล</label>
              <input className="form-input" value={exitReason} onChange={(e) => setExitReason(e.target.value)} />
            </div>
          </div>
          <div className="row-between" style={{ marginTop: 14 }}>
            <div className="spacer" />
            <button className="btn btn-danger" onClick={submit} disabled={busy || !picked.length}>
              {busy ? 'กำลังบันทึก…' : `บันทึก ${picked.length} คน`}
            </button>
          </div>
        </div>
      )}

      {/* History — searchable, filterable, reinstate */}
      <div className="stack" style={{ gap: 10 }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h2 className="page-title" style={{ fontSize: 18 }}>รายชื่อที่ลาออก / พักการเรียน</h2>
          <div style={{ position: 'relative', maxWidth: 280, width: '100%' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--skdw-muted)' }}>
              <IconSearch width={15} height={15} />
            </span>
            <input
              className="form-input"
              style={{ paddingLeft: 32 }}
              placeholder="ค้นหาในรายชื่อ…"
              value={histQuery}
              onChange={(e) => setHistQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Filters: academic year + exit-date range */}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">ปีการศึกษา</label>
            <select
              className="form-select"
              style={{ width: 140 }}
              value={histYear === 'all' ? 'all' : String(histYear)}
              onChange={(e) => setHistYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">ทุกปี</option>
              {histYearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">ตั้งแต่วันที่ (ว/ด/ปพ.ศ.)</label>
            <input className="form-input" style={{ width: 150 }} placeholder="เช่น 01/04/2568"
              value={histFrom} onChange={(e) => setHistFrom(e.target.value)} />
          </div>
          <div>
            <label className="form-label">ถึงวันที่ (ว/ด/ปพ.ศ.)</label>
            <input className="form-input" style={{ width: 150 }} placeholder="เช่น 31/03/2569"
              value={histTo} onChange={(e) => setHistTo(e.target.value)} />
          </div>
          {(histYear !== 'all' || histFrom || histTo) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setHistYear('all'); setHistFrom(''); setHistTo(''); }}>
              ล้างตัวกรอง
            </button>
          )}
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 13 }}>{filteredHistory.length} รายการ</span>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ปีที่ออก</th><th>ชั้น/ห้อง</th>
                  <th>ประเภท</th><th>วันที่</th><th>เหตุผล</th><th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {histLoading && <tr><td colSpan={8}><div className="skeleton" style={{ height: 20 }} /></td></tr>}
                {!histLoading && filteredHistory.length === 0 && (
                  <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                    {history.length === 0 ? 'ยังไม่มีรายชื่อ' : 'ไม่พบรายชื่อที่ค้นหา'}
                  </td></tr>
                )}
                {filteredHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="mono">
                      <a href={`/users/students/${h.id}`} style={{ color: 'var(--skdw-purple)' }}>{h.studentCode}</a>
                    </td>
                    <td>{fullName(h)}</td>
                    <td>{h.exitYear ?? '-'}</td>
                    <td>{h.gradeLevel ?? '-'} / {h.classroom ?? '-'}</td>
                    <td><span className="badge badge-warning">{h.exitType ?? '-'}</span></td>
                    <td>{h.exitDate ?? '-'}</td>
                    <td className="muted">{h.exitReason ?? '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setReinstateTarget(h)}>
                        <IconRestore width={14} height={14} /> คืนสถานะ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {reinstateTarget && (
        <ReinstateDialog
          studentId={reinstateTarget.id}
          studentLabel={`${reinstateTarget.studentCode} ${fullName(reinstateTarget)}`}
          defaultGrade={reinstateTarget.gradeLevel}
          defaultClassroom={reinstateTarget.classroom}
          onClose={() => setReinstateTarget(null)}
          onDone={() => { setReinstateTarget(null); loadHistory(); }}
        />
      )}
    </div>
  );
}

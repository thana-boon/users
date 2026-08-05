'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { Combo } from './Combo';
import { IconSearch, IconPlus, IconRestore, IconTrash } from './Icons';
import { LEAVE_TYPE_OPTIONS, LEAVE_REASON_OPTIONS } from '@/lib/options';

/**
 * พักการเรียน — search for a student who is still studying, record the leave
 * (type + start date + expected return + reason), and later record the return.
 *
 * A LEAVE IS NOT AN EXIT. Nothing here touches `students.status`: the student
 * stays on the roll, keeps their room, and is promoted at year end like anyone
 * else — school policy is that a leave never costs a year. That is why this is
 * a separate page from จำหน่าย/ลาออก rather than another exit type on it.
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
interface LeaveRow {
  id: number; studentId: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; gender: string | null;
  leaveType: string; startDate: string | null; expectedReturnDate: string | null;
  returnedDate: string | null; reason: string | null; orderNo: string | null;
  year: number | null; gradeLevel: string | null; classroom: string | null;
}

const fullName = (r: { prefix: string | null; firstName: string; lastName: string }) =>
  `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim();

/** Parse a raw Thai date "d/m/BBBB" into a sortable YYYYMMDD number (BE year kept). */
function parseThaiDate(s: string | null): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
}

export function LeaveTool() {
  const toast = useToast();
  const confirm = useConfirm();

  const [years, setYears] = useState<YearOpt[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);

  // -- search + selection --
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const searchSeq = useRef(0);

  // -- leave fields --
  const [leaveType, setLeaveType] = useState('พักการเรียน');
  const [startDate, setStartDate] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [reason, setReason] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [busy, setBusy] = useState(false);

  // -- history --
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [histQuery, setHistQuery] = useState('');
  const [histYear, setHistYear] = useState<'all' | number>('all');

  // -- return dialog --
  const [returnTarget, setReturnTarget] = useState<LeaveRow | null>(null);

  // เลขที่คำสั่ง only applies to a disciplinary suspension.
  const disciplinary = leaveType === 'ถูกสั่งพักการเรียน';

  useEffect(() => {
    api<Meta>('/api/users/meta').then((m) => {
      setYears(m.years);
      const active = m.years.find((y) => y.isActive) ?? m.years[m.years.length - 1];
      if (active) setYearId(active.id);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ data: LeaveRow[] }>(`/api/users/leaves?scope=${scope}`);
      setRows(res.data);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [scope, toast]);

  useEffect(() => { load(); }, [load]);

  // Debounced search over students still on the roll.
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
  // Students already away — offering them again would just be skipped server-side.
  const onLeaveIds = useMemo(
    () => new Set(rows.filter((r) => !r.returnedDate).map((r) => r.studentId)),
    [rows],
  );

  function addStudent(r: SearchRow) {
    if (pickedIds.has(r.id)) return;
    setPicked((p) => [...p, {
      id: r.id, studentCode: r.studentCode, name: fullName(r),
      gradeLevel: r.gradeLevel, classroom: r.classroom,
    }]);
  }
  const removeStudent = (id: number) => setPicked((p) => p.filter((x) => x.id !== id));

  async function submit() {
    if (!yearId) return toast('ยังไม่พบปีการศึกษา', 'error');
    if (!picked.length) return toast('ยังไม่ได้เลือกนักเรียน', 'error');
    if (!startDate.trim()) return toast('ระบุวันที่เริ่มพัก', 'error');

    const yearLabel = years.find((y) => y.id === yearId)?.year;
    if (!(await confirm({
      title: 'ยืนยันการบันทึก',
      message: `บันทึก “${leaveType}” (ปีการศึกษา ${yearLabel ?? '-'}) ให้ ${picked.length} คน? นักเรียนยังคงสถานะกำลังศึกษาและเลื่อนชั้นตามปกติ`,
      confirmText: `บันทึก ${picked.length} คน`,
    }))) return;

    setBusy(true);
    try {
      const res = await api<{ created: number; skipped: number[] }>('/api/users/leaves', jsonBody({
        academicYearId: yearId,
        studentIds: picked.map((p) => p.id),
        leaveType,
        startDate,
        expectedReturnDate: expectedReturnDate || null,
        reason: reason || null,
        orderNo: disciplinary ? orderNo || null : null,
      }));
      toast(
        res.skipped.length
          ? `บันทึก ${res.created} คน (ข้าม ${res.skipped.length} คนที่พักอยู่แล้ว)`
          : `บันทึก ${res.created} คนสำเร็จ`,
        'success',
      );
      setPicked([]);
      setQ('');
      setResults([]);
      setStartDate('');
      setExpectedReturnDate('');
      setReason('');
      setOrderNo('');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: LeaveRow) {
    if (!(await confirm({
      title: 'ลบรายการพักการเรียน',
      message: `ลบรายการ “${r.leaveType}” ของ ${r.studentCode} ${fullName(r)}? ใช้เมื่อบันทึกผิดเท่านั้น`,
      confirmText: 'ลบรายการ',
      danger: true,
    }))) return;
    try {
      await api(`/api/users/leaves/${r.id}`, { method: 'DELETE' });
      toast('ลบรายการแล้ว', 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const yearOpts = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) if (r.year != null) s.add(r.year);
    return [...s].sort((a, b) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    const term = histQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (term &&
        !(r.studentCode.toLowerCase().includes(term) ||
          fullName(r).toLowerCase().includes(term) ||
          r.leaveType.toLowerCase().includes(term))) return false;
      if (histYear !== 'all' && r.year !== histYear) return false;
      return true;
    });
  }, [rows, histQuery, histYear]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="page-title">พักการเรียน</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          บันทึกการพักการเรียนพร้อมวันที่เริ่ม กำหนดกลับ และเหตุผล — นักเรียน<strong>ไม่ได้ออกจากโรงเรียน</strong>{' '}
          ยังคงสถานะกำลังศึกษา อยู่ในบัญชีรายชื่อห้อง และเลื่อนชั้นตามปกติ เมื่อกลับมาให้กดบันทึกวันที่กลับในตารางด้านล่าง.
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
              const away = onLeaveIds.has(r.id);
              return (
                <div key={r.id} className="row-between" style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--skdw-border)' }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="mono" style={{ color: 'var(--skdw-muted)' }}>{r.studentCode}</span>
                    <span>{fullName(r)}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{r.gradeLevel ?? '-'}/{r.classroom ?? '-'}</span>
                    {away && <span className="badge badge-warning">พักอยู่แล้ว</span>}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => addStudent(r)} disabled={added || away}>
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

      {/* Leave fields + submit */}
      {picked.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="form-label">ปีการศึกษา</label>
              <select className="form-select" style={{ width: 140 }} value={yearId ?? ''} onChange={(e) => setYearId(Number(e.target.value))}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.year}{y.isActive ? ' (ปัจจุบัน)' : ''}</option>)}
              </select>
            </div>
            <Combo
              label="ประเภท"
              value={leaveType}
              onChange={setLeaveType}
              options={LEAVE_TYPE_OPTIONS}
              normalize={false}
              style={{ width: 190 }}
            />
            <div>
              <label className="form-label required">เริ่มพัก (ว/ด/ปพ.ศ.)</label>
              <input className="form-input" style={{ width: 160 }} placeholder="เช่น 01/07/2569"
                value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">กำหนดกลับ (ถ้ามี)</label>
              <input className="form-input" style={{ width: 160 }} placeholder="เช่น 01/11/2569"
                value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} />
            </div>
            {disciplinary && (
              <div>
                <label className="form-label">เลขที่คำสั่ง</label>
                <input className="form-input" style={{ width: 150 }} placeholder="เช่น 45/2569"
                  value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
              </div>
            )}
            <Combo
              label="เหตุผล"
              value={reason}
              onChange={setReason}
              options={LEAVE_REASON_OPTIONS}
              normalize={false}
              placeholder="เลือกจากรายการหรือพิมพ์เอง"
              style={{ flex: 1, minWidth: 240 }}
            />
          </div>
          <div className="row-between" style={{ marginTop: 14 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              นักเรียนยังคงสถานะ “กำลังศึกษา” — ไม่ถูกจำหน่ายและไม่กระทบการเลื่อนชั้น
            </span>
            <button className="btn btn-primary" onClick={submit} disabled={busy || !picked.length}>
              {busy ? 'กำลังบันทึก…' : `บันทึก ${picked.length} คน`}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      <div className="stack" style={{ gap: 10 }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h2 className="page-title" style={{ fontSize: 18 }}>
            {scope === 'open' ? 'กำลังพักการเรียนอยู่' : 'ประวัติการพักการเรียนทั้งหมด'}
          </h2>
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

        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">แสดง</label>
            <select className="form-select" style={{ width: 190 }} value={scope} onChange={(e) => setScope(e.target.value as 'open' | 'all')}>
              <option value="open">เฉพาะที่ยังพักอยู่</option>
              <option value="all">ทั้งหมด (รวมที่กลับมาแล้ว)</option>
            </select>
          </div>
          <div>
            <label className="form-label">ปีการศึกษา</label>
            <select
              className="form-select"
              style={{ width: 140 }}
              value={histYear === 'all' ? 'all' : String(histYear)}
              onChange={(e) => setHistYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">ทุกปี</option>
              {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 13 }}>{filtered.length} รายการ</span>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ปี</th><th>ชั้น/ห้อง</th>
                  <th>ประเภท</th><th>เริ่มพัก</th><th>กำหนดกลับ</th><th>เหตุผล</th>
                  <th>สถานะ</th><th style={{ width: 150 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={10}><div className="skeleton" style={{ height: 20 }} /></td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                    {rows.length === 0
                      ? (scope === 'open' ? 'ไม่มีนักเรียนที่พักการเรียนอยู่' : 'ยังไม่มีประวัติการพักการเรียน')
                      : 'ไม่พบรายชื่อที่ค้นหา'}
                  </td></tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">
                      <a href={`/users/students/${r.studentId}`} style={{ color: 'var(--skdw-purple)' }}>{r.studentCode}</a>
                    </td>
                    <td>{fullName(r)}</td>
                    <td>{r.year ?? '-'}</td>
                    <td>{r.gradeLevel ?? '-'} / {r.classroom ?? '-'}</td>
                    <td>
                      <span className="badge badge-warning">{r.leaveType}</span>
                      {r.orderNo && <span className="muted" style={{ fontSize: 12 }}> · {r.orderNo}</span>}
                    </td>
                    <td>{r.startDate ?? '-'}</td>
                    <td>{r.expectedReturnDate ?? '-'}</td>
                    <td className="muted">{r.reason ?? '-'}</td>
                    <td>
                      {r.returnedDate
                        ? <span className="badge badge-success">กลับแล้ว {r.returnedDate}</span>
                        : <span className="badge badge-muted">พักอยู่</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!r.returnedDate && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setReturnTarget(r)}>
                          <IconRestore width={14} height={14} /> กลับมาเรียน
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" aria-label="ลบรายการ" onClick={() => remove(r)}>
                        <IconTrash width={14} height={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {returnTarget && (
        <ReturnDialog
          row={returnTarget}
          onClose={() => setReturnTarget(null)}
          onDone={() => { setReturnTarget(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * Record the return date. There is no status to restore — the student never
 * left — so this only stamps `returnedDate` on the open episode.
 */
function ReturnDialog({ row, onClose, onDone }: { row: LeaveRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [returnedDate, setReturnedDate] = useState(row.expectedReturnDate ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // A return before the start date is a typo, not a fact — catch it here rather
  // than storing a range that reads backwards in the register.
  const validReturn = useMemo(() => {
    const start = parseThaiDate(row.startDate);
    const back = parseThaiDate(returnedDate);
    return back != null && (start == null || back >= start);
  }, [row.startDate, returnedDate]);

  async function submit() {
    if (!returnedDate.trim()) return toast('กรุณาระบุวันที่กลับมาเรียน', 'error');
    if (!validReturn) return toast('วันที่กลับต้องอยู่หลังวันที่เริ่มพัก และอยู่ในรูปแบบ ว/ด/ปพ.ศ.', 'error');
    setBusy(true);
    try {
      await api(`/api/users/leaves/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ returnedDate, note: note || null }),
      });
      toast('บันทึกกลับมาเรียนแล้ว', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="บันทึกกลับมาเรียน">
      <div className="modal">
        <div className="card-header">บันทึกกลับมาเรียน</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <p className="muted" style={{ fontSize: 13 }}>
            <strong>{row.studentCode} {fullName(row)}</strong> — {row.leaveType} ตั้งแต่ {row.startDate ?? '-'}
          </p>
          <div>
            <label className="form-label required">วันที่กลับมาเรียน (ว/ด/ปพ.ศ.)</label>
            <input className="form-input" placeholder="เช่น 01/11/2569"
              value={returnedDate} onChange={(e) => setReturnedDate(e.target.value)} />
          </div>
          <div>
            <label className="form-label">หมายเหตุ (ถ้ามี)</label>
            <input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            ชั้น/ห้องไม่เปลี่ยน — นักเรียนอยู่ในทะเบียนตลอดช่วงที่พัก จึงกลับเข้าห้องเดิมได้ทันที
          </p>
          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

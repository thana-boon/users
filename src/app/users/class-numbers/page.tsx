'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';

interface YearOpt { id: number; year: number; isActive: boolean }
interface Meta { years: YearOpt[]; grades: string[]; classrooms: string[] }
interface Row {
  enrollmentId: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; gender: string | null; status: string;
  classNumber: string | null; seqOrder: number | null;
}

type SortBy = 'gender_code' | 'code' | 'name' | 'gender_name';
const SORT_LABEL: Record<SortBy, string> = {
  gender_code: 'เพศ → รหัสนักเรียน',
  code: 'รหัสนักเรียน',
  name: 'ชื่อ',
  gender_name: 'เพศ → ชื่อ',
};
const STATUS_LABEL: Record<string, string> = {
  studying: 'กำลังศึกษา', withdrawn: 'จำหน่าย/ลาออก', graduated: 'จบการศึกษา',
};

function cmp(a: string | null, b: string | null) {
  return (a ?? '￿').localeCompare(b ?? '￿', 'th');
}

function ClassNumbersInner() {
  const toast = useToast();
  const params = useSearchParams();
  const [meta, setMeta] = useState<Meta>({ years: [], grades: [], classrooms: [] });
  const [yearId, setYearId] = useState<number | ''>('');
  const [grade, setGrade] = useState(params.get('grade') ?? '');
  const [room, setRoom] = useState(params.get('classroom') ?? '');
  const [rows, setRows] = useState<Row[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>('gender_code');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api<Meta>('/api/users/meta').then((m) => {
      setMeta(m);
      const active = m.years.find((y) => y.isActive) ?? m.years[m.years.length - 1];
      if (active) setYearId(active.id);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!yearId || !grade || !room) { setRows([]); return; }
    setLoading(true);
    try {
      const sp = new URLSearchParams({ yearId: String(yearId), grade, classroom: room });
      const res = await api<{ data: Row[] }>(`/api/users/enrollments?${sp}`);
      setRows(res.data);
      setDirty(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [yearId, grade, room, toast]);

  useEffect(() => { load(); }, [load]);

  function autoNumber() {
    const sorters: Record<SortBy, (a: Row, b: Row) => number> = {
      code: (a, b) => cmp(a.studentCode, b.studentCode),
      name: (a, b) => cmp(a.firstName, b.firstName) || cmp(a.lastName, b.lastName),
      gender_code: (a, b) => cmp(a.gender, b.gender) || cmp(a.studentCode, b.studentCode),
      gender_name: (a, b) => cmp(a.gender, b.gender) || cmp(a.firstName, b.firstName),
    };
    // Studying students get fresh 1..N; withdrawn/graduated keep their number
    // and drop to the bottom (they are not part of the active class numbering).
    const studying = rows.filter((r) => r.status === 'studying').sort(sorters[sortBy]);
    const others = rows.filter((r) => r.status !== 'studying');
    let n = 1;
    const next: Row[] = [
      ...studying.map((r) => ({ ...r, classNumber: String(n), seqOrder: n++ })),
      ...others.map((r) => ({ ...r, seqOrder: 9000 + (r.seqOrder ?? 0) })),
    ];
    setRows(next);
    setDirty(true);
  }

  function editNumber(id: number, v: string) {
    setRows((s) => s.map((r) => (r.enrollmentId === id ? { ...r, classNumber: v || null } : r)));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    try {
      const assignments = rows.map((r) => ({
        enrollmentId: r.enrollmentId,
        classNumber: r.classNumber,
        seqOrder: r.seqOrder,
      }));
      const res = await api<{ updated: number }>(
        '/api/users/class-numbers',
        jsonBody({ yearId, grade, classroom: room, assignments }),
      );
      toast(`บันทึกเลขที่ ${res.updated} คนแล้ว`, 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const ready = yearId && grade && room;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="page-title">จัดเลขที่</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          จัดเรียงเลขที่ตามเพศ/รหัส/ชื่อ หรือแก้รายคนได้. ระหว่างปีเลขที่จะคงช่องว่างไว้เมื่อมีคนลาออก
          — กด “จัดเรียง 1..N” เมื่อต้องการรันเลขใหม่.
        </p>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">ปีการศึกษา</label>
            <select className="form-select" style={{ width: 140 }} value={yearId} onChange={(e) => setYearId(Number(e.target.value))}>
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
            <label className="form-label">ห้อง</label>
            <select className="form-select" style={{ width: 130 }} value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">— เลือกห้อง —</option>
              {meta.classrooms.map((c) => <option key={c} value={c}>ห้อง {c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">เรียงตาม</label>
            <select className="form-select" style={{ width: 180 }} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              {(Object.keys(SORT_LABEL) as SortBy[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={autoNumber} disabled={!ready || !rows.length}>จัดเรียง 1..N</button>
        </div>
      </div>

      {ready && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 90 }}>เลขที่</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>เพศ</th><th>สถานะ</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={5}><div className="skeleton" style={{ height: 20 }} /></td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>ไม่พบนักเรียนในห้องนี้</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.enrollmentId} style={{ opacity: r.status === 'studying' ? 1 : 0.55 }}>
                    <td>
                      <input className="form-input mono" style={{ width: 70, textAlign: 'center' }}
                        value={r.classNumber ?? ''} onChange={(e) => editNumber(r.enrollmentId, e.target.value)} />
                    </td>
                    <td className="mono">{r.studentCode}</td>
                    <td>{r.prefix ?? ''}{r.firstName} {r.lastName}</td>
                    <td>{r.gender ?? '-'}</td>
                    <td>{r.status === 'studying'
                      ? <span className="muted" style={{ fontSize: 12 }}>กำลังศึกษา</span>
                      : <span className="badge" style={{ background: 'var(--skdw-bg)' }}>{STATUS_LABEL[r.status] ?? r.status}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-between" style={{ padding: 16 }}>
            <span className="muted" style={{ fontSize: 13 }}>{rows.length} คน{dirty ? ' • มีการแก้ไขที่ยังไม่บันทึก' : ''}</span>
            <button className="btn btn-primary" onClick={save} disabled={busy || !rows.length}>{busy ? 'กำลังบันทึก…' : 'บันทึกเลขที่'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClassNumbersPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
      <ClassNumbersInner />
    </Suspense>
  );
}

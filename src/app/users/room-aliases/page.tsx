'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';

/**
 * ชื่อห้อง — give a room a name beside its number (อ.3/1 → อ.3/เฟื่องฟ้า). The
 * number stays the room's identity everywhere; the name is display only and
 * rides along in /api/public/v1/homerooms and /api/public/v1/students. Names
 * are not per year — the year picker only chooses which rooms to list.
 *
 * Saves itself: a pause in typing or leaving the field writes the name, so
 * filling a whole ชั้น is type → Tab → type with no buttons in between.
 */

interface Room {
  gradeLevel: string;
  classroom: string;
  studentCount: number;
  alias: string | null;
}

interface YearOpt { id: number; year: number; isActive: boolean }

type RowStatus = { state: 'saving' } | { state: 'saved' } | { state: 'error'; message: string };

const keyOf = (r: Room) => `${r.gradeLevel}|${r.classroom}`;
/** Same normalisation the server applies, so "saved" compares like for like. */
const clean = (v: string) => v.trim().replace(/\s+/g, ' ');
const DEBOUNCE_MS = 800;

export default function RoomAliasesPage() {
  const toast = useToast();
  const [years, setYears] = useState<YearOpt[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [loading, setLoading] = useState(true);

  // Per-room plumbing that must not re-render: the pending debounce timer, the
  // last value the server has (or is being sent), and whether a request is in
  // flight — one request per room at a time, so saves can't land out of order.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const savedVal = useRef(new Map<string, string>());
  const inflight = useRef(new Set<string>());
  const latest = useRef(new Map<string, { room: Room; value: string }>());

  useEffect(() => {
    api<{ yearId: number; years: YearOpt[] }>('/api/users/meta')
      .then((m) => {
        setYears([...m.years].sort((a, b) => b.year - a.year));
        setYearId(m.yearId);
      })
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const load = useCallback(async (yid: number) => {
    setLoading(true);
    try {
      const res = await api<{ rooms: Room[] }>(`/api/users/room-aliases?yearId=${yid}`);
      setRooms(res.rooms);
      setDrafts({});
      setStatus({});
      savedVal.current = new Map(res.rooms.map((r) => [keyOf(r), r.alias ?? '']));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (yearId != null) load(yearId);
  }, [yearId, load]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const save = useCallback(async (k: string) => {
    const next = latest.current.get(k);
    if (!next || inflight.current.has(k)) return;
    const value = clean(next.value);
    if (value === savedVal.current.get(k)) return;

    inflight.current.add(k);
    setStatus((s) => ({ ...s, [k]: { state: 'saving' } }));
    try {
      await api('/api/users/room-aliases', jsonBody({
        gradeLevel: next.room.gradeLevel,
        classroom: next.room.classroom,
        alias: value,
      }));
      savedVal.current.set(k, value);
      setRooms((prev) => prev.map((x) => (keyOf(x) === k ? { ...x, alias: value || null } : x)));
      setStatus((s) => ({ ...s, [k]: { state: 'saved' } }));
    } catch (e) {
      setStatus((s) => ({ ...s, [k]: { state: 'error', message: (e as Error).message } }));
    } finally {
      inflight.current.delete(k);
    }
    // Typed on while that request was out? Send the newer value now.
    const after = latest.current.get(k);
    if (after && clean(after.value) !== value) save(k);
  }, []);

  function change(r: Room, value: string) {
    const k = keyOf(r);
    setDrafts((d) => ({ ...d, [k]: value }));
    latest.current.set(k, { room: r, value });
    clearTimeout(timers.current.get(k));
    timers.current.set(k, setTimeout(() => save(k), DEBOUNCE_MS));
  }

  function flush(k: string) {
    clearTimeout(timers.current.get(k));
    timers.current.delete(k);
    save(k);
  }

  const grades = useMemo(() => {
    const m = new Map<string, Room[]>();
    for (const r of rooms) {
      const list = m.get(r.gradeLevel) ?? [];
      list.push(r);
      m.set(r.gradeLevel, list);
    }
    return [...m.entries()];
  }, [rooms]);

  const named = rooms.filter((r) => r.alias).length;

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 1000 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">ชื่อห้อง</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            ตั้งชื่อเรียกห้อง เช่น อ.3/1 → อ.3/เฟื่องฟ้า — พิมพ์แล้วบันทึกอัตโนมัติ ลบชื่อออกเพื่อกลับไปใช้เลขห้อง
            · ชื่อใช้ได้ทุกปีการศึกษา และส่งไปกับ <code className="mono">/api/public/v1/homerooms</code> และ <code className="mono">/api/public/v1/students</code>
          </p>
        </div>
        <select
          className="form-select"
          style={{ width: 170 }}
          value={yearId ?? ''}
          onChange={(e) => setYearId(Number(e.target.value))}
          aria-label="ปีการศึกษา"
        >
          {years.map((y) => (
            <option key={y.id} value={y.id}>ปีการศึกษา {y.year}{y.isActive ? ' (ปัจจุบัน)' : ''}</option>
          ))}
        </select>
      </div>

      <div className="grid-3">
        <div className="stat"><span className="stat-label">ห้องทั้งหมด</span><span className="stat-value">{rooms.length.toLocaleString('th-TH')}</span></div>
        <div className="stat"><span className="stat-label">มีชื่อห้อง</span><span className="stat-value">{named.toLocaleString('th-TH')}</span></div>
        <div className="stat"><span className="stat-label">ใช้เลขห้อง</span><span className="stat-value">{(rooms.length - named).toLocaleString('th-TH')}</span></div>
      </div>

      {loading && rooms.length === 0 && (
        <div className="card" style={{ padding: 24 }}><div className="skeleton" style={{ height: 120 }} /></div>
      )}

      {!loading && rooms.length === 0 && (
        <div className="card muted" style={{ padding: 40, textAlign: 'center' }}>
          ยังไม่มีห้องเรียนในปีนี้ — ห้องจะปรากฏเมื่อมีนักเรียนถูกจัดเข้าห้อง (หน้า จัดเข้าห้อง / เลื่อนชั้น)
        </div>
      )}

      {grades.map(([grade, list]) => (
        <div className="card" key={grade} style={{ padding: 0 }}>
          <div className="card-header">{grade}</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>ห้อง</th>
                  <th className="num" style={{ width: 90 }}>นักเรียน</th>
                  <th>ชื่อห้อง</th>
                  <th style={{ width: 160 }}>แสดงเป็น</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const k = keyOf(r);
                  const value = drafts[k] ?? r.alias ?? '';
                  const st = status[k];
                  const shown = clean(value) || r.classroom;
                  return (
                    <tr key={k}>
                      <td><b>{r.gradeLevel}/{r.classroom}</b></td>
                      <td className="num mono">{r.studentCount.toLocaleString('th-TH')}</td>
                      <td>
                        <input
                          className="form-input"
                          style={{
                            minWidth: 140,
                            width: '100%',
                            ...(st?.state === 'error' ? { borderColor: 'var(--tone-red)' } : {}),
                          }}
                          maxLength={64}
                          placeholder="ไม่มีชื่อ — ใช้เลขห้อง"
                          value={value}
                          onChange={(e) => change(r, e.target.value)}
                          onBlur={() => flush(k)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') flush(k);
                          }}
                          aria-label={`ชื่อห้อง ${r.gradeLevel}/${r.classroom}`}
                          aria-invalid={st?.state === 'error' || undefined}
                        />
                        {st && (
                          <div
                            style={{
                              fontSize: 12,
                              marginTop: 4,
                              color: st.state === 'error' ? 'var(--tone-red)' : 'var(--skdw-muted)',
                            }}
                            role={st.state === 'error' ? 'alert' : 'status'}
                          >
                            {st.state === 'saving' && 'กำลังบันทึก…'}
                            {st.state === 'saved' && '✓ บันทึกแล้ว'}
                            {st.state === 'error' && st.message}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={clean(value) ? 'badge badge-purple' : 'muted'}>{r.gradeLevel}/{shown}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

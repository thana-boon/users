'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';

/**
 * ชื่อห้อง — give a room a name beside its number (อ.3/1 → อ.3/เฟื่องฟ้า). The
 * number stays the room's identity everywhere; the name is display only and
 * rides along in /api/public/v1/homerooms and /api/public/v1/students. Names
 * are not per year — the year picker only chooses which rooms to list.
 */

interface Room {
  gradeLevel: string;
  classroom: string;
  studentCount: number;
  alias: string | null;
}

interface YearOpt { id: number; year: number; isActive: boolean }

const keyOf = (r: Room) => `${r.gradeLevel}|${r.classroom}`;

export default function RoomAliasesPage() {
  const toast = useToast();
  const [years, setYears] = useState<YearOpt[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (yearId != null) load(yearId);
  }, [yearId, load]);

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

  async function save(r: Room, value: string) {
    const k = keyOf(r);
    setSaving(k);
    try {
      await api('/api/users/room-aliases', jsonBody({
        gradeLevel: r.gradeLevel,
        classroom: r.classroom,
        alias: value,
      }));
      const alias = value.trim().replace(/\s+/g, ' ') || null;
      setRooms((prev) => prev.map((x) => (keyOf(x) === k ? { ...x, alias } : x)));
      setDrafts(({ [k]: _, ...rest }) => rest);
      toast(alias ? `ตั้งชื่อ ${r.gradeLevel}/${r.classroom} เป็น ${r.gradeLevel}/${alias} แล้ว` : `ลบชื่อห้อง ${r.gradeLevel}/${r.classroom} แล้ว`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 1000 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">ชื่อห้อง</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            ตั้งชื่อเรียกห้อง เช่น อ.3/1 → อ.3/เฟื่องฟ้า — เลขห้องยังคงอยู่ ชื่อใช้ได้ทุกปีการศึกษา
            และส่งไปกับ <code className="mono">/api/public/v1/homerooms</code> และ <code className="mono">/api/public/v1/students</code>
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
                  const dirty = value.trim() !== (r.alias ?? '');
                  const busy = saving === k;
                  const shown = value.trim() || r.classroom;
                  return (
                    <tr key={k}>
                      <td><b>{r.gradeLevel}/{r.classroom}</b></td>
                      <td className="num mono">{r.studentCount.toLocaleString('th-TH')}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <input
                            className="form-input"
                            style={{ minWidth: 140, flex: 1 }}
                            maxLength={64}
                            placeholder="ไม่มีชื่อ — ใช้เลขห้อง"
                            value={value}
                            disabled={busy}
                            onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && dirty) save(r, value);
                              if (e.key === 'Escape') setDrafts(({ [k]: _, ...rest }) => rest);
                            }}
                            aria-label={`ชื่อห้อง ${r.gradeLevel}/${r.classroom}`}
                          />
                          {dirty && (
                            <button className="btn btn-primary btn-sm" onClick={() => save(r, value)} disabled={busy}>
                              บันทึก
                            </button>
                          )}
                          {!dirty && r.alias && (
                            <button className="btn btn-ghost btn-sm" onClick={() => save(r, '')} disabled={busy}>
                              ลบ
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={value.trim() ? 'badge badge-purple' : 'muted'}>{r.gradeLevel}/{shown}</span>
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

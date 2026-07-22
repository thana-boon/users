'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconSearch } from '@/components/Icons';

/**
 * ครูประจำชั้น — pick a year, see every ชั้น/ห้อง that has students, and assign
 * one or more homeroom teachers (ครูคู่ชั้น supported) per room. Consumed by
 * other systems via GET /api/public/v1/homerooms (scope teachers:read).
 */

interface TeacherLite {
  id: number;
  teacherCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  subjectGroup: string | null;
  employmentStatus?: string;
}

interface Room {
  gradeLevel: string;
  classroom: string;
  studentCount: number;
  teachers: TeacherLite[];
}

interface YearOpt { id: number; year: number; isActive: boolean }

const teacherName = (t: TeacherLite) => `${t.prefix ?? ''}${t.firstName} ${t.lastName}`.trim();

export default function HomeroomsPage() {
  const toast = useToast();
  const [years, setYears] = useState<YearOpt[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<TeacherLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Room | null>(null);

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
      const res = await api<{ rooms: Room[]; teachers: TeacherLite[] }>(`/api/users/homerooms?yearId=${yid}`);
      setRooms(res.rooms);
      setTeachers(res.teachers);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (yearId != null) load(yearId);
  }, [yearId, load]);

  // Group rooms by grade for section rendering (rooms arrive pre-sorted).
  const grades = useMemo(() => {
    const m = new Map<string, Room[]>();
    for (const r of rooms) {
      const list = m.get(r.gradeLevel) ?? [];
      list.push(r);
      m.set(r.gradeLevel, list);
    }
    return [...m.entries()];
  }, [rooms]);

  const assignedRooms = rooms.filter((r) => r.teachers.length > 0).length;

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 1000 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">ครูประจำชั้น</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            กำหนดครูประจำชั้นของแต่ละห้อง — ระบบอื่นดึงได้ผ่าน <code className="mono">/api/public/v1/homerooms</code>
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
        <div className="stat"><span className="stat-label">กำหนดแล้ว</span><span className="stat-value">{assignedRooms.toLocaleString('th-TH')}</span></div>
        <div className="stat"><span className="stat-label">ยังไม่กำหนด</span><span className="stat-value">{(rooms.length - assignedRooms).toLocaleString('th-TH')}</span></div>
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
              <thead><tr><th style={{ width: 90 }}>ห้อง</th><th className="num" style={{ width: 90 }}>นักเรียน</th><th>ครูประจำชั้น</th><th style={{ width: 90 }}></th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={`${r.gradeLevel}|${r.classroom}`}>
                    <td><b>{r.gradeLevel}/{r.classroom}</b></td>
                    <td className="num mono">{r.studentCount.toLocaleString('th-TH')}</td>
                    <td>
                      {r.teachers.length === 0 ? (
                        <span className="muted" style={{ fontSize: 13 }}>ยังไม่กำหนด</span>
                      ) : (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          {r.teachers.map((t) => (
                            <span key={t.id} className="badge badge-purple" title={`${t.teacherCode}${t.subjectGroup ? ` · ${t.subjectGroup}` : ''}`}>
                              {teacherName(t)}
                              {t.employmentStatus === 'resigned' && <span style={{ opacity: 0.7 }}> (ลาออกแล้ว)</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <button className="chip" onClick={() => setEditing(r)}>กำหนด</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {editing && yearId != null && (
        <AssignDialog
          room={editing}
          teachers={teachers}
          yearId={yearId}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load(yearId);
            toast('บันทึกครูประจำชั้นแล้ว', 'success');
          }}
        />
      )}
    </div>
  );
}

function AssignDialog({
  room, teachers, yearId, onClose, onDone,
}: {
  room: Room;
  teachers: TeacherLite[];
  yearId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<number[]>(room.teachers.map((t) => t.id));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return teachers;
    return teachers.filter((t) =>
      `${t.teacherCode} ${t.prefix ?? ''}${t.firstName} ${t.lastName} ${t.subjectGroup ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [teachers, q]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    try {
      await api('/api/users/homerooms', jsonBody({
        academicYearId: yearId,
        gradeLevel: room.gradeLevel,
        classroom: room.classroom,
        teacherIds: selected,
      }));
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const byId = new Map(teachers.map((t) => [t.id, t]));
  // A resigned/archived teacher still assigned to the room is not in the active
  // picker list — keep them visible via the room's own data so unticking works.
  const extraSelected = room.teachers.filter((t) => !byId.has(t.id));

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={`กำหนดครูประจำชั้น ${room.gradeLevel}/${room.classroom}`}>
      <div className="modal" style={{ width: 'min(520px, 92vw)' }}>
        <div className="card-header">ครูประจำชั้น {room.gradeLevel}/{room.classroom}</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--skdw-muted)' }}>
              <IconSearch width={18} height={18} />
            </span>
            <input
              className="form-input"
              style={{ paddingLeft: 38 }}
              placeholder="ค้นหารหัส / ชื่อครู / กลุ่มสาระ"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="ค้นหาครู"
            />
          </div>

          <div className="muted" style={{ fontSize: 12 }}>
            เลือกได้มากกว่า 1 คน (ครูคู่ชั้น) — เลือกแล้ว {selected.length} คน
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto', border: '0.5px solid var(--skdw-border)', borderRadius: 8 }}>
            {extraSelected.map((t) => (
              <label key={t.id} className="row" style={{ gap: 10, padding: '8px 12px', cursor: 'pointer', opacity: 0.7 }}>
                <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                <span style={{ flex: 1 }}>
                  {teacherName(t)} <span className="muted mono" style={{ fontSize: 11 }}>{t.teacherCode}</span>
                  <span className="badge badge-muted" style={{ marginLeft: 6, fontSize: 10 }}>ไม่อยู่ในรายชื่อครูปัจจุบัน</span>
                </span>
              </label>
            ))}
            {filtered.map((t) => (
              <label key={t.id} className="row" style={{ gap: 10, padding: '8px 12px', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                <span style={{ flex: 1 }}>
                  {teacherName(t)}{' '}
                  <span className="muted mono" style={{ fontSize: 11 }}>{t.teacherCode}</span>
                  {t.subjectGroup && <span className="muted" style={{ fontSize: 11 }}> · {t.subjectGroup}</span>}
                </span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="muted" style={{ padding: 16, textAlign: 'center', fontSize: 13 }}>ไม่พบครูที่ค้นหา</div>
            )}
          </div>
        </div>
        <div className="row-between card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <div className="row" style={{ gap: 8 }}>
            {selected.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected([])} disabled={busy}>ล้างทั้งหมด</button>
            )}
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>บันทึก</button>
          </div>
        </div>
      </div>
    </div>
  );
}

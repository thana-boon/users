'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { refreshSubjectGroups } from '@/components/SubjectGroupSelect';
import { IconPlus, IconEdit, IconTrash, IconChevron } from '@/components/Icons';

/**
 * กลุ่มสาระ — the school's own list, and the only place a กลุ่มสาระ is spelled.
 *
 * Everything on this page is built around one promise to the admin: the ครู and
 * อาจารย์พิเศษ already filed under these names do not move. Each row shows how
 * many people it holds, renaming carries them along (the server does both in
 * one transaction), and deleting a group that still holds people is refused
 * outright — ซ่อน is offered instead, which keeps their stored value untouched.
 */

interface Row {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  teacherCount: number;
  specialTeacherCount: number;
}

interface Orphan {
  name: string;
  teacherCount: number;
  specialTeacherCount: number;
}

export default function SubjectGroupsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ data: Row[]; orphans: Orphan[] }>(
        '/api/users/subject-groups?withCounts=1&includeInactive=1',
      );
      setRows(res.data);
      setOrphans(res.orphans ?? []);
      refreshSubjectGroups();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(r: Row) {
    if (r.isActive && !(await confirm({
      title: 'ซ่อนกลุ่มสาระ',
      message: `ซ่อน “${r.name}” จากตัวเลือก? คนที่อยู่ในกลุ่มนี้ (${r.teacherCount + r.specialTeacherCount} คน) จะยังคงกลุ่มสาระเดิมไว้ทุกประการ เพียงแต่จะเลือกกลุ่มนี้ให้คนใหม่ไม่ได้อีก`,
      confirmText: 'ซ่อน',
    }))) return;
    try {
      await api(`/api/users/subject-groups/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !r.isActive }),
      });
      toast(r.isActive ? 'ซ่อนแล้ว' : 'เปิดใช้งานแล้ว', 'success');
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function remove(r: Row) {
    const total = r.teacherCount + r.specialTeacherCount;
    if (total > 0) {
      toast(`ลบไม่ได้ — ยังมี ${total} คนอยู่ในกลุ่มสาระนี้ ให้ย้ายออกก่อน หรือกด “ซ่อน”`, 'error');
      return;
    }
    if (!(await confirm({
      title: 'ลบกลุ่มสาระ',
      message: `ลบ “${r.name}” ออกจากรายการ? ไม่มีใครอยู่ในกลุ่มนี้ จึงไม่มีข้อมูลบุคลากรได้รับผลกระทบ`,
      confirmText: 'ลบ',
      danger: true,
    }))) return;
    try {
      await api(`/api/users/subject-groups/${r.id}`, { method: 'DELETE' });
      toast('ลบแล้ว', 'success');
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  /** Move one row and persist the whole order — see PUT on the API route. */
  async function move(index: number, delta: number) {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next); // optimistic: the arrows must feel instant
    setBusy(true);
    try {
      await api('/api/users/subject-groups', {
        method: 'PUT',
        body: JSON.stringify({ ids: next.map((r) => r.id) }),
      });
      refreshSubjectGroups();
    } catch (e) {
      toast((e as Error).message, 'error');
      load(); // put the list back the way the server still has it
    } finally { setBusy(false); }
  }

  const totalPeople = rows.reduce((n, r) => n + r.teacherCount + r.specialTeacherCount, 0);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">กลุ่มสาระ</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
            รายการกลุ่มสาระของโรงเรียน — หน้าครูและอาจารย์พิเศษจะเลือกจากรายการนี้เท่านั้น จึงไม่มีปัญหาพิมพ์ผิดแล้วชื่อไม่ตรงกัน
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <IconPlus width={16} height={16} /> เพิ่มกลุ่มสาระ
        </button>
      </div>

      <div className="alert alert-info" style={{ fontSize: 13 }}>
        การเปลี่ยนชื่อกลุ่มสาระที่นี่ จะเปลี่ยนให้ครูและอาจารย์พิเศษทุกคนในกลุ่มนั้นตามไปด้วยในคราวเดียว
        ข้อมูลเดิมของทุกคนจึงไม่หลุดกลุ่ม และ API ที่ดึงด้วย <span className="mono">?subjectGroup=</span> ยังตรงกันเสมอ
      </div>

      {orphans.length > 0 && (
        <div className="alert alert-warning" style={{ fontSize: 13 }}>
          <strong>มีกลุ่มสาระที่ยังไม่อยู่ในรายการ</strong> — บุคลากรกลุ่มนี้ยังใช้งานได้ตามปกติ
          แต่จะเลือกให้คนใหม่ไม่ได้จนกว่าจะกด “เพิ่มกลุ่มสาระ” ด้วยชื่อเดียวกัน:
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {orphans.map((o) => (
              <li key={o.name}>
                {o.name} — ครู {o.teacherCount} คน, อาจารย์พิเศษ {o.specialTeacherCount} คน
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>ลำดับ</th>
                <th>ชื่อกลุ่มสาระ</th>
                <th style={{ width: 90 }}>ครู</th>
                <th style={{ width: 120 }}>อาจารย์พิเศษ</th>
                <th style={{ width: 90 }}>สถานะ</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 20 }} /></td></tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                    ยังไม่มีกลุ่มสาระ — กด “เพิ่มกลุ่มสาระ” เพื่อเริ่ม
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.55 }}>
                  <td>
                    <div className="row" style={{ gap: 2 }}>
                      <button
                        className="btn btn-ghost btn-sm" title="เลื่อนขึ้น" aria-label={`เลื่อน ${r.name} ขึ้น`}
                        style={{ padding: '2px 6px' }}
                        disabled={i === 0 || busy} onClick={() => move(i, -1)}
                      >
                        <IconChevron width={14} height={14} style={{ transform: 'rotate(90deg)' }} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm" title="เลื่อนลง" aria-label={`เลื่อน ${r.name} ลง`}
                        style={{ padding: '2px 6px' }}
                        disabled={i === rows.length - 1 || busy} onClick={() => move(i, 1)}
                      >
                        <IconChevron width={14} height={14} style={{ transform: 'rotate(-90deg)' }} />
                      </button>
                    </div>
                  </td>
                  <td>{r.name}</td>
                  <td>
                    {r.teacherCount > 0
                      ? <Link className="chip" href={`/users/teachers?subjectGroup=${encodeURIComponent(r.name)}`}>{r.teacherCount} คน</Link>
                      : <span className="muted">0</span>}
                  </td>
                  <td>
                    {r.specialTeacherCount > 0
                      ? <Link className="chip" href={`/users/special-teachers?subjectGroup=${encodeURIComponent(r.name)}`}>{r.specialTeacherCount} คน</Link>
                      : <span className="muted">0</span>}
                  </td>
                  <td>
                    <span className={`badge ${r.isActive ? 'badge-success' : 'badge-muted'}`}>
                      {r.isActive ? 'ใช้งาน' : 'ซ่อน'}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>
                        <IconEdit width={14} height={14} /> เปลี่ยนชื่อ
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)}>
                        {r.isActive ? 'ซ่อน' : 'เปิดใช้'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        title={r.teacherCount + r.specialTeacherCount > 0 ? 'ลบไม่ได้ — ยังมีคนอยู่ในกลุ่มนี้' : 'ลบ'}
                        style={{ color: 'var(--color-error)' }}
                        onClick={() => remove(r)}
                      >
                        <IconTrash width={14} height={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-between" style={{ padding: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {rows.length} กลุ่มสาระ · บุคลากรที่ระบุกลุ่มแล้ว {totalPeople.toLocaleString('th-TH')} คน
          </span>
        </div>
      </div>

      {editing && (
        <SubjectGroupDialog
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(msg) => { setEditing(null); toast(msg, 'success'); load(); }}
        />
      )}
    </div>
  );
}

function SubjectGroupDialog({
  row, onClose, onDone,
}: {
  row: Row | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [busy, setBusy] = useState(false);
  const affected = row ? row.teacherCount + row.specialTeacherCount : 0;

  async function submit() {
    const v = name.trim();
    if (!v) { toast('กรุณากรอกชื่อกลุ่มสาระ', 'error'); return; }
    setBusy(true);
    try {
      if (row) {
        const res = await api<{ moved: number }>(`/api/users/subject-groups/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: v }),
        });
        onDone(res.moved > 0 ? `เปลี่ยนชื่อแล้ว — ย้ายตาม ${res.moved} คน` : 'เปลี่ยนชื่อแล้ว');
      } else {
        await api('/api/users/subject-groups', jsonBody({ name: v }));
        onDone('เพิ่มกลุ่มสาระแล้ว');
      }
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={row ? 'เปลี่ยนชื่อกลุ่มสาระ' : 'เพิ่มกลุ่มสาระ'}>
      <div className="modal">
        <div className="card-header">{row ? 'เปลี่ยนชื่อกลุ่มสาระ' : 'เพิ่มกลุ่มสาระ'}</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div>
            <label className="form-label required">ชื่อกลุ่มสาระ</label>
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น กลุ่มสาระการเรียนรู้ภาษาไทย"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
            <p className="form-hint">
              พิมพ์ให้ตรงกับที่โรงเรียนใช้จริง — ชื่อนี้คือค่าที่ระบบอื่นจะได้รับผ่าน API
            </p>
          </div>
          {row && affected > 0 && (
            <div className="alert alert-warning" style={{ fontSize: 13 }}>
              กลุ่มนี้มีอยู่ {affected} คน (ครู {row.teacherCount}, อาจารย์พิเศษ {row.specialTeacherCount}) —
              เมื่อเปลี่ยนชื่อ ทุกคนจะถูกย้ายมาใช้ชื่อใหม่พร้อมกัน ไม่มีใครหลุดกลุ่ม
            </div>
          )}
        </div>
        <div className="row-between card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}

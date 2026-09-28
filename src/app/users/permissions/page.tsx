'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { PhotoThumb } from '@/components/PhotoThumb';
import { IconSearch, IconShield, IconStudents, IconTeachers } from '@/components/Icons';

/**
 * จัดการสิทธิ์ — who may do what in this module.
 *
 * Three roles, all stored on `teachers.role`:
 *   ครู          — their own record only (/users/me)
 *   moderator    — plus every student page (registry, placements, promotions,
 *                  numbering, exits, leaves, former students); nothing else
 *   ผู้ดูแลระบบ  — everything
 *
 * The role is read at login, so a change applies from that person's next
 * sign-in — the banner says so, because "I gave them access and it didn't
 * work" is the first thing anyone would hit otherwise.
 */

type Role = 'teacher' | 'moderator' | 'teacher-admin';

interface Row {
  id: number;
  teacherCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  subjectGroup: string | null;
  role: Role;
  employmentStatus: 'active' | 'resigned';
  hasPhoto: boolean;
}

interface Res {
  rows: Row[];
  counts: Record<Role, number>;
  me: string;
}

const ROLES: { value: Role; label: string; badge: string; Icon: typeof IconShield; desc: string }[] = [
  {
    value: 'teacher-admin',
    label: 'ผู้ดูแลระบบ',
    badge: 'badge-gold',
    Icon: IconShield,
    desc: 'ทุกเมนู: นักเรียน บุคลากร ปีการศึกษา ตั้งค่า API สำรองข้อมูล บันทึกการใช้งาน และจัดการสิทธิ์',
  },
  {
    value: 'moderator',
    label: 'moderator',
    badge: 'badge-purple',
    Icon: IconStudents,
    desc: 'เฉพาะเมนูนักเรียน: ทะเบียน จัดเข้าห้อง เลื่อนชั้น จัดเลขที่ จบ/พัก/จำหน่าย นักเรียนเก่า นำเข้า-ส่งออก',
  },
  {
    value: 'teacher',
    label: 'ครู',
    badge: 'badge-muted',
    Icon: IconTeachers,
    desc: 'ดูและแก้ไขข้อมูลของตนเองที่หน้า “ข้อมูลของฉัน” เท่านั้น',
  },
];

const labelOf = (r: Role) => ROLES.find((x) => x.value === r)!.label;

export default function PermissionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Res | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const deb = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (role) sp.set('role', role);
      setData(await api<Res>(`/api/users/permissions?${sp}`));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [q, role, toast]);

  useEffect(() => {
    clearTimeout(deb.current);
    deb.current = setTimeout(load, 300);
    return () => clearTimeout(deb.current);
  }, [load]);

  async function change(r: Row, next: Role) {
    if (next === r.role) return;
    const name = `${r.prefix ?? ''}${r.firstName} ${r.lastName}`;
    const ok = await confirm({
      title: 'เปลี่ยนสิทธิ์',
      message:
        `${name} (${r.teacherCode})\n${labelOf(r.role)} → ${labelOf(next)}\n\n` +
        'มีผลเมื่อผู้ใช้นี้เข้าสู่ระบบครั้งถัดไป',
      confirmText: 'เปลี่ยนสิทธิ์',
      danger: next === 'teacher-admin',
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      await api('/api/users/permissions', { method: 'PATCH', ...jsonBody({ teacherId: r.id, role: next }) });
      toast(`เปลี่ยน ${name} เป็น ${labelOf(next)} แล้ว`, 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const rows = data?.rows ?? [];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="page-title">จัดการสิทธิ์</h1>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
          กำหนดว่าบัญชีครูแต่ละคนเข้าถึงส่วนใดของระบบได้บ้าง
        </p>
      </div>

      <div className="perm-roles">
        {ROLES.map(({ value, label, badge, Icon, desc }) => (
          <button
            key={value}
            type="button"
            className="card perm-role"
            data-active={role === value}
            aria-pressed={role === value}
            onClick={() => setRole(role === value ? '' : value)}
          >
            <div className="row-between" style={{ alignItems: 'center' }}>
              <span className={`badge ${badge}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon width={13} height={13} /> {label}
              </span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {data ? data.counts[value].toLocaleString('th-TH') : '–'}
              </span>
            </div>
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5 }}>{desc}</p>
          </button>
        ))}
      </div>

      <div className="alert alert-info" style={{ fontSize: 14 }}>
        การเปลี่ยนสิทธิ์มีผลเมื่อผู้ใช้เข้าสู่ระบบครั้งถัดไป — ถ้าเขาเข้าระบบอยู่แล้ว ให้ออกจากระบบแล้วเข้าใหม่
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--skdw-muted)' }}>
              <IconSearch width={18} height={18} />
            </span>
            <input
              className="form-input"
              style={{ paddingLeft: 38 }}
              placeholder="ค้นหารหัส / ชื่อครู"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="ค้นหาครู"
            />
          </div>
          <select
            className="form-select"
            style={{ width: 170 }}
            value={role}
            onChange={(e) => setRole(e.target.value as Role | '')}
            aria-label="กรองตามสิทธิ์"
          >
            <option value="">ทุกสิทธิ์</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>รูป</th>
                <th>รหัส</th>
                <th>ชื่อ-นามสกุล</th>
                <th>กลุ่มสาระ</th>
                <th>สถานะ</th>
                <th style={{ width: 190 }}>สิทธิ์</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 20 }} /></td></tr>
                ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 40 }}>ไม่พบครูที่ค้นหา</td></tr>
              )}
              {rows.map((r) => {
                const isMe = r.teacherCode === data?.me;
                return (
                  <tr key={r.id}>
                    <td style={{ paddingTop: 6, paddingBottom: 6 }}>
                      <PhotoThumb
                        src={r.hasPhoto ? `/api/users/teachers/${r.id}/photo` : null}
                        initials={(r.firstName[0] ?? '') + (r.lastName[0] ?? '')}
                        alt={`${r.firstName} ${r.lastName}`}
                      />
                    </td>
                    <td className="mono">{r.teacherCode}</td>
                    <td>
                      {r.prefix ?? ''}{r.firstName} {r.lastName}
                      {isMe && <span className="muted" style={{ fontSize: 12 }}> (คุณ)</span>}
                    </td>
                    <td style={{ fontSize: 13 }}>{r.subjectGroup ?? '-'}</td>
                    <td>
                      <span className={`badge ${r.employmentStatus === 'resigned' ? 'badge-muted' : 'badge-success'}`}>
                        {r.employmentStatus === 'resigned' ? 'ลาออกแล้ว' : 'ทำงานอยู่'}
                      </span>
                    </td>
                    <td>
                      <select
                        className="form-select"
                        value={r.role}
                        disabled={isMe || busyId === r.id}
                        title={isMe ? 'เปลี่ยนสิทธิ์ของตนเองไม่ได้' : undefined}
                        onChange={(e) => change(r, e.target.value as Role)}
                        aria-label={`สิทธิ์ของ ${r.firstName} ${r.lastName}`}
                      >
                        {ROLES.map((x) => (
                          <option key={x.value} value={x.value}>{x.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>ทั้งหมด {rows.length.toLocaleString('th-TH')} คน</span>
        </div>
      </div>

      <style>{`
        .perm-roles {
          display: grid; gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        .perm-role {
          text-align: left; cursor: pointer; font-family: inherit; color: inherit;
          border: 1px solid var(--skdw-border);
          transition: border-color var(--transition-fast), background var(--transition-fast);
        }
        .perm-role:hover { border-color: var(--skdw-purple); }
        .perm-role[data-active="true"] {
          border-color: var(--skdw-purple); background: var(--skdw-purple-pale);
        }
      `}</style>
    </div>
  );
}

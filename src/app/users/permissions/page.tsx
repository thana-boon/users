'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { PhotoThumb } from '@/components/PhotoThumb';
import { IconEdit, IconPlus, IconSearch, IconShield } from '@/components/Icons';
import { CAPABILITIES, type Capability } from '@/lib/permissions';

/**
 * จัดการสิทธิ์ — who holds access to this module, and how much.
 *
 * Lists only the accounts that HAVE access (admins + moderators); everyone
 * else is an ordinary teacher and is reached through "เพิ่มผู้ใช้สิทธิ์".
 * A moderator is given capabilities one tick-box at a time (the catalog is
 * CAPABILITIES in lib/permissions.ts, which also decides what each one opens).
 *
 * A new grant shows up at that person's next sign-in — the banner says so;
 * a removed one stops working at once.
 */

type Access = 'admin' | 'moderator' | 'none';

interface Person {
  id: number;
  teacherCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  subjectGroup: string | null;
  employmentStatus: 'active' | 'resigned';
  hasPhoto: boolean;
  access: Access;
  capabilities: Capability[];
  grantedBy?: string | null;
}

const capLabel = (c: Capability) => CAPABILITIES.find((x) => x.key === c)!.label;
const fullName = (p: Person) => `${p.prefix ?? ''}${p.firstName} ${p.lastName}`;
const GROUPS = [...new Set(CAPABILITIES.map((c) => c.group))];

export default function PermissionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Person[] | null>(null);
  const [me, setMe] = useState('');
  const [editing, setEditing] = useState<Person | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ rows: Person[]; me: string }>('/api/users/permissions');
      setRows(res.rows);
      setMe(res.me);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(p: Person) {
    const ok = await confirm({
      title: 'ถอนสิทธิ์',
      message: `${fullName(p)} (${p.teacherCode})\nจะกลับเป็นครูทั่วไป — เข้าได้เฉพาะหน้า “ข้อมูลของฉัน”`,
      confirmText: 'ถอนสิทธิ์',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('/api/users/permissions', {
        method: 'PUT',
        body: JSON.stringify({ teacherId: p.id, access: 'none', capabilities: [] }),
      });
      toast(`ถอนสิทธิ์ ${fullName(p)} แล้ว`, 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const admins = rows?.filter((r) => r.access === 'admin').length ?? 0;
  const mods = rows?.filter((r) => r.access === 'moderator').length ?? 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">จัดการสิทธิ์</h1>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
            ผู้ดูแลระบบ {admins} คน · moderator {mods} คน — ครูคนอื่นเข้าได้เฉพาะหน้า “ข้อมูลของฉัน”
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <IconPlus width={16} height={16} /> เพิ่มผู้ใช้สิทธิ์
        </button>
      </div>

      <div className="alert alert-info" style={{ fontSize: 14 }}>
        สิทธิ์ที่เพิ่มให้จะมีผลเมื่อผู้ใช้<strong>เข้าสู่ระบบครั้งถัดไป</strong> ส่วนสิทธิ์ที่ถอนออกจะหยุดใช้ได้ทันที
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>รูป</th>
                <th>รหัส</th>
                <th>ชื่อ-นามสกุล</th>
                <th>สิทธิ์</th>
                <th style={{ width: 170 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows === null &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td colSpan={5}><div className="skeleton" style={{ height: 20 }} /></td></tr>
                ))}
              {rows?.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 40 }}>ยังไม่มีผู้ใช้สิทธิ์</td></tr>
              )}
              {rows?.map((r) => {
                const isMe = r.teacherCode === me;
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
                      {fullName(r)}
                      {isMe && <span className="muted" style={{ fontSize: 12 }}> (คุณ)</span>}
                      {r.employmentStatus === 'resigned' && (
                        <span className="badge badge-muted" style={{ marginLeft: 6 }}>ลาออกแล้ว</span>
                      )}
                    </td>
                    <td>
                      {r.access === 'admin' ? (
                        <span className="badge badge-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <IconShield width={13} height={13} /> ผู้ดูแลระบบ · ทุกเมนู
                        </span>
                      ) : (
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          <span className="badge badge-purple">moderator</span>
                          {r.capabilities.map((c) => (
                            <span key={c} className="chip" style={{ fontSize: 12 }}>{capLabel(c)}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {isMe ? (
                        <span className="muted" style={{ fontSize: 12 }}>เปลี่ยนสิทธิ์ตนเองไม่ได้</span>
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>
                            <IconEdit width={14} height={14} /> แก้ไข
                          </button>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={() => revoke(r)}>
                            ถอนสิทธิ์
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <GrantDialog
          person={editing === 'new' ? null : editing}
          me={me}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Add or edit one person's access. Adding starts with a teacher search (by
 * code or name, 20 at a time); editing skips straight to the access choice.
 */
function GrantDialog({
  person,
  me,
  onClose,
  onSaved,
}: {
  person: Person | null;
  me: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<Person | null>(person);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [access, setAccess] = useState<'admin' | 'moderator'>(person?.access === 'admin' ? 'admin' : 'moderator');
  const [caps, setCaps] = useState<Capability[]>(person?.capabilities ?? []);
  const [busy, setBusy] = useState(false);
  const deb = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (picked) return;
    clearTimeout(deb.current);
    if (!q.trim()) {
      setFound([]);
      return;
    }
    deb.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api<{ rows: Person[] }>(`/api/users/permissions?candidates=${encodeURIComponent(q.trim())}`);
        setFound(res.rows);
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(deb.current);
  }, [q, picked, toast]);

  function pick(p: Person) {
    setPicked(p);
    // Someone who already has access: start from what they have.
    setAccess(p.access === 'admin' ? 'admin' : 'moderator');
    setCaps(p.capabilities);
  }

  const toggle = (c: Capability) =>
    setCaps((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  async function save() {
    if (!picked) return;
    if (access === 'moderator' && caps.length === 0) {
      toast('เลือกอย่างน้อย 1 สิทธิ์', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/api/users/permissions', {
        method: 'PUT',
        body: JSON.stringify({ teacherId: picked.id, access, capabilities: access === 'admin' ? [] : caps }),
      });
      toast(`บันทึกสิทธิ์ของ ${fullName(picked)} แล้ว`, 'success');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const title = person ? 'แก้ไขสิทธิ์' : 'เพิ่มผู้ใช้สิทธิ์';

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="stack" style={{ gap: 16, padding: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>

          {!picked ? (
            <div>
              <label className="form-label required" htmlFor="grant-q">เลือกครู</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--skdw-muted)' }}>
                  <IconSearch width={18} height={18} />
                </span>
                <input
                  id="grant-q"
                  autoFocus
                  className="form-input"
                  style={{ paddingLeft: 38 }}
                  placeholder="พิมพ์รหัสครู หรือชื่อ"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <div className="stack" style={{ gap: 4, marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
                {searching && <div className="skeleton" style={{ height: 36 }} />}
                {!searching && q.trim() && found.length === 0 && (
                  <p className="muted" style={{ fontSize: 13, margin: 4 }}>ไม่พบครูที่ค้นหา</p>
                )}
                {found.map((p) => {
                  const self = p.teacherCode === me;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="grant-pick"
                      disabled={self}
                      onClick={() => pick(p)}
                    >
                      <span className="mono" style={{ fontSize: 13, minWidth: 64 }}>{p.teacherCode}</span>
                      <span style={{ flex: 1 }}>{fullName(p)}</span>
                      {self ? (
                        <span className="muted" style={{ fontSize: 12 }}>คุณ</span>
                      ) : p.access === 'admin' ? (
                        <span className="badge badge-gold">ผู้ดูแลระบบ</span>
                      ) : p.access === 'moderator' ? (
                        <span className="badge badge-purple">moderator</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div className="row-between" style={{ padding: '10px 12px', background: 'var(--skdw-bg)', borderRadius: 'var(--radius-sm)' }}>
                <span>
                  <span className="mono" style={{ fontSize: 13 }}>{picked.teacherCode}</span>{' '}
                  <strong>{fullName(picked)}</strong>
                </span>
                {!person && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>
                    เปลี่ยนคน
                  </button>
                )}
              </div>

              <div>
                <span className="form-label required">ระดับสิทธิ์</span>
                <div className="grid-2" style={{ marginTop: 4 }}>
                  <label className="grant-opt" data-on={access === 'moderator'}>
                    <input type="radio" name="access" checked={access === 'moderator'} onChange={() => setAccess('moderator')} />
                    <span>
                      <strong>moderator</strong>
                      <span className="grant-sub">เลือกได้ว่าทำอะไรได้บ้าง</span>
                    </span>
                  </label>
                  <label className="grant-opt" data-on={access === 'admin'}>
                    <input type="radio" name="access" checked={access === 'admin'} onChange={() => setAccess('admin')} />
                    <span>
                      <strong>ผู้ดูแลระบบ</strong>
                      <span className="grant-sub">ทุกเมนู รวมถึงตั้งค่าและจัดการสิทธิ์</span>
                    </span>
                  </label>
                </div>
              </div>

              {access === 'moderator' ? (
                <div className="stack" style={{ gap: 12 }}>
                  {GROUPS.map((g) => (
                    <div key={g}>
                      <span className="form-label">{g}</span>
                      <div className="stack" style={{ gap: 6, marginTop: 4 }}>
                        {CAPABILITIES.filter((c) => c.group === g).map((c) => (
                          <label key={c.key} className="grant-opt" data-on={caps.includes(c.key)}>
                            <input type="checkbox" checked={caps.includes(c.key)} onChange={() => toggle(c.key)} />
                            <span>
                              <strong style={{ fontWeight: 600 }}>{c.label}</strong>
                              <span className="grant-sub">{c.desc}</span>
                            </span>
                            {c.key.endsWith('.sensitive') && (
                              <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>PII</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="form-hint" style={{ margin: 0 }}>
                    ภาพรวม ถังขยะ ตั้งค่าระบบ จัดการสิทธิ์ API Manager สำรองข้อมูล
                    และการเปลี่ยนรหัสผ่าน/สิทธิ์ของครู ให้ได้เฉพาะผู้ดูแลระบบ
                  </p>
                </div>
              ) : (
                <div className="alert alert-warning" style={{ fontSize: 13 }}>
                  ผู้ดูแลระบบเข้าได้ทุกเมนู ดูรหัสผ่านทุกคนได้ และให้/ถอนสิทธิ์คนอื่นได้ — ให้เฉพาะคนที่จำเป็น
                </div>
              )}
            </>
          )}

          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !picked}>
              {busy ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .grant-pick {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 8px 10px; border: 1px solid var(--skdw-border); border-radius: var(--radius-sm);
          background: #fff; cursor: pointer; text-align: left; font-family: inherit; font-size: 14px; color: inherit;
        }
        .grant-pick:hover:not(:disabled) { border-color: var(--skdw-purple); background: var(--skdw-purple-pale); }
        .grant-pick:disabled { opacity: 0.55; cursor: not-allowed; }
        .grant-opt {
          display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px;
          border: 1px solid var(--skdw-border); border-radius: var(--radius-sm); cursor: pointer;
        }
        .grant-opt input { margin-top: 3px; }
        .grant-opt[data-on="true"] { border-color: var(--skdw-purple); background: var(--skdw-purple-pale); }
        .grant-sub { display: block; font-size: 12px; color: var(--skdw-muted); }
      `}</style>
    </div>
  );
}

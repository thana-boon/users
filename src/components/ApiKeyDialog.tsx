'use client';

import { useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';
import { API_SCOPES, SCOPE_LABEL_TH, PII_SCOPES, AUTH_SCOPES, type ApiScope } from '@/lib/api-scopes';

/**
 * สร้าง / แก้ไข API key.
 *
 * โหมดสร้าง (ไม่ส่ง `existing`) จะคืนค่า key เต็มกลับมาครั้งเดียว — หน้า manager
 * เป็นคนแสดงผลผ่าน RevealDialog. โหมดแก้ไขเปลี่ยนได้เฉพาะชื่อ/สิทธิ์/วันหมดอายุ
 * (ตัวรหัสลับเปลี่ยนผ่านปุ่ม "สร้างรหัสใหม่" เท่านั้น).
 */

export interface ApiKeyFormValue {
  id: number;
  name: string;
  description: string | null;
  scopes: string[];
  expiresAt: string | null;
}

export function ApiKeyDialog({
  existing,
  onClose,
  onDone,
}: {
  existing?: ApiKeyFormValue;
  onClose: () => void;
  onDone: (created?: { plain: string; name: string }) => void;
}) {
  const toast = useToast();
  const editing = !!existing;

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [scopes, setScopes] = useState<string[]>(existing?.scopes ?? ['students:read']);
  // <input type="date"> wants yyyy-mm-dd; the API speaks ISO datetime.
  const [expires, setExpires] = useState(existing?.expiresAt?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);

  function toggle(s: ApiScope) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function submit() {
    if (!name.trim()) return toast('กรุณาระบุชื่อระบบที่จะมาเรียก', 'error');
    if (scopes.length === 0) return toast('กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ', 'error');

    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        scopes,
        // End-of-day so a key picked for "31 ธ.ค." stays usable through that day.
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      };
      if (editing) {
        await api(`/api/users/api-keys/${existing!.id}`, {
          ...jsonBody(body),
          method: 'PATCH',
        });
        toast('บันทึกการแก้ไขแล้ว', 'success');
        onDone();
      } else {
        const res = await api<{ plain: string; name: string }>(
          '/api/users/api-keys',
          jsonBody(body),
        );
        onDone({ plain: res.plain, name: res.name });
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={editing ? 'แก้ไข API key' : 'สร้าง API key'}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="stack" style={{ gap: 16, padding: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>
            {editing ? 'แก้ไข API key' : 'สร้าง API key ใหม่'}
          </h2>

          <div>
            <label className="form-label required" htmlFor="ak-name">ชื่อระบบ</label>
            <input
              id="ak-name"
              className="form-input"
              placeholder="เช่น ระบบห้องสมุด"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="form-hint">ชื่อนี้จะขึ้นในบันทึกการใช้งาน เมื่อระบบนั้นมาดึงข้อมูล</p>
          </div>

          <div>
            <label className="form-label" htmlFor="ak-desc">รายละเอียด</label>
            <textarea
              id="ak-desc"
              className="form-textarea"
              placeholder="ใช้ทำอะไร / ติดต่อใคร"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <span className="form-label required">สิทธิ์ที่ให้ (scope)</span>
            <div className="stack" style={{ gap: 8, marginTop: 4 }}>
              {API_SCOPES.map((s) => {
                const pii = PII_SCOPES.includes(s);
                const auth = AUTH_SCOPES.includes(s);
                return (
                  <label
                    key={s}
                    className="row"
                    style={{
                      gap: 10,
                      alignItems: 'flex-start',
                      padding: '8px 10px',
                      border: '1px solid var(--skdw-border)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={() => toggle(s)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <span className="mono" style={{ fontSize: 13 }}>{s}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--skdw-muted)' }}>
                        {SCOPE_LABEL_TH[s]}
                        {pii && ' · ถอดรหัสข้อมูลอ่อนไหว'}
                      </span>
                    </span>
                    {pii && <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>PII</span>}
                    {auth && <span className="badge badge-navy" style={{ marginLeft: 'auto' }}>AUTH</span>}
                  </label>
                );
              })}
            </div>
            {scopes.some((s) => PII_SCOPES.includes(s as ApiScope)) && (
              <div className="alert alert-warning" style={{ marginTop: 10, fontSize: 13 }}>
                สิทธิ์ PII จะส่ง<strong>เลขบัตรประชาชน</strong>ออกไปให้ระบบอื่น
                ทุกครั้งที่มีการดึงจะถูกบันทึกใน “บันทึกการใช้งาน” — ให้เฉพาะระบบที่จำเป็นจริง ๆ
              </div>
            )}
            {scopes.some((s) => AUTH_SCOPES.includes(s as ApiScope)) && (
              <div className="alert alert-info" style={{ marginTop: 10, fontSize: 13 }}>
                สิทธิ์ AUTH ให้ระบบนั้น<strong>ตรวจรหัสผ่านได้</strong> (ใช้ทำหน้าล็อกอินของเขาเอง)
                — ระบบจะไม่ส่งรหัสผ่านกลับไป และการตรวจทุกครั้งถูกบันทึกไว้
              </div>
            )}
          </div>

          <div>
            <label className="form-label" htmlFor="ak-exp">วันหมดอายุ</label>
            <input
              id="ak-exp"
              type="date"
              className="form-input"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
            <p className="form-hint">เว้นว่าง = ไม่มีวันหมดอายุ</p>
          </div>

          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : editing ? 'บันทึก' : 'สร้าง key'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * แสดง key เต็ม — ใช้ทั้งตอนสร้างเสร็จ, ตอนกด "ดู" (reveal), และตอนสร้างรหัสใหม่
 * (rotate). ผู้ใช้เลือกเก็บแบบถอดรหัสได้ ดังนั้นหน้านี้เปิดซ้ำได้เสมอ —
 * แต่ทุกครั้งที่กดดู ระบบจะเขียน audit ไว้.
 */
export function RevealDialog({
  value,
  title,
  note,
  onClose,
}: {
  value: string;
  title: string;
  note?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('คัดลอกไม่สำเร็จ — กรุณาคัดลอกเอง', 'error');
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="stack" style={{ gap: 14, padding: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>
          {note && <div className="alert alert-info" style={{ fontSize: 13 }}>{note}</div>}

          <div
            className="mono"
            style={{
              padding: '12px 14px',
              background: 'var(--skdw-bg)',
              border: '1px solid var(--skdw-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {value}
          </div>

          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={onClose}>ปิด</button>
          </div>
        </div>
      </div>
    </div>
  );
}

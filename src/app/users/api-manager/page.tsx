'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, jsonBody, BASE_PATH } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconSearch, IconPlus, IconKey } from '@/components/Icons';
import { ApiKeyDialog, RevealDialog, type ApiKeyFormValue } from '@/components/ApiKeyDialog';
import { SCOPE_LABEL_TH, PII_SCOPES, type ApiScope } from '@/lib/api-scopes';

/**
 * API Manager — ออก/ตรวจสอบ/เพิกถอน API key ที่ให้ระบบอื่นมาดึงรายชื่อ
 * นักเรียน–ครู ผ่าน /api/public/v1/*.
 *
 * หน้านี้อยู่ใต้ /users/** จึงถูก middleware บังคับสิทธิ์ users:write อยู่แล้ว
 * และทุก route ที่มันเรียกก็ตรวจซ้ำอีกชั้น (requireTeacherAdmin).
 */

interface KeyRow {
  id: number;
  name: string;
  description: string | null;
  keyPrefix: string;
  masked: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  usageCount: number;
  createdByLabel: string | null;
  createdAt: string;
}

interface Stats { total: number; active: number; calls: number }

const STATUS_BADGE: Record<KeyRow['status'], { cls: string; label: string }> = {
  active: { cls: 'badge-success', label: 'ใช้งานอยู่' },
  revoked: { cls: 'badge-muted', label: 'ปิดใช้งาน' },
  expired: { cls: 'badge-warning', label: 'หมดอายุ' },
};

function thaiDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ApiManagerPage() {
  const toast = useToast();
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, calls: 0 });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<ApiKeyFormValue | null>(null);
  const [revealed, setRevealed] = useState<{ value: string; title: string; note?: string } | null>(null);
  const deb = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (status) sp.set('status', status);
      const res = await api<{ data: KeyRow[]; stats: Stats }>(`/api/users/api-keys?${sp}`);
      setRows(res.data);
      setStats(res.stats);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [q, status, toast]);

  useEffect(() => {
    clearTimeout(deb.current);
    deb.current = setTimeout(load, 300);
    return () => clearTimeout(deb.current);
  }, [load]);

  async function reveal(r: KeyRow) {
    try {
      const res = await api<{ plain: string }>(`/api/users/api-keys/${r.id}/reveal`, { method: 'POST' });
      setRevealed({
        value: res.plain,
        title: `API key · ${r.name}`,
        note: 'การเปิดดูครั้งนี้ถูกบันทึกไว้ในบันทึกการใช้งานแล้ว',
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function rotate(r: KeyRow) {
    if (!confirm(`สร้างรหัสใหม่ให้ “${r.name}”?\n\nรหัสเดิมจะใช้ไม่ได้ทันที — ต้องนำรหัสใหม่ไปตั้งค่าในระบบนั้นด้วย`)) return;
    try {
      const res = await api<{ plain: string }>(`/api/users/api-keys/${r.id}/rotate`, { method: 'POST' });
      setRevealed({
        value: res.plain,
        title: `รหัสใหม่ · ${r.name}`,
        note: 'รหัสเดิมใช้ไม่ได้แล้ว กรุณานำรหัสนี้ไปตั้งค่าในระบบปลายทาง',
      });
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function toggleActive(r: KeyRow) {
    const turningOff = r.isActive;
    if (turningOff && !confirm(`ปิดใช้งาน “${r.name}”?\n\nระบบนั้นจะดึงข้อมูลไม่ได้ทันที`)) return;
    try {
      await api(`/api/users/api-keys/${r.id}`, {
        ...jsonBody({ isActive: !r.isActive }),
        method: 'PATCH',
      });
      toast(turningOff ? 'ปิดใช้งาน key แล้ว' : 'เปิดใช้งาน key แล้ว', 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">API Manager</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            ออก key ให้ระบบอื่นมาดึงรายชื่อนักเรียน–ครู ผ่าน <code className="mono">/api/public/v1</code>
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
          <IconPlus width={16} height={16} /> สร้าง key
        </button>
      </div>

      <div className="grid-3">
        <div className="stat"><span className="stat-label">key ทั้งหมด</span><span className="stat-value">{stats.total.toLocaleString('th-TH')}</span></div>
        <div className="stat"><span className="stat-label">ใช้งานอยู่</span><span className="stat-value">{stats.active.toLocaleString('th-TH')}</span></div>
        <div className="stat"><span className="stat-label">จำนวนครั้งที่ถูกเรียก</span><span className="stat-value">{stats.calls.toLocaleString('th-TH')}</span></div>
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
              placeholder="ค้นหาชื่อระบบ / prefix"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="ค้นหา API key"
            />
          </div>
          <select className="form-select" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะ">
            <option value="">ทุกสถานะ</option>
            <option value="active">ใช้งานอยู่</option>
            <option value="revoked">ปิดใช้งาน</option>
            <option value="expired">หมดอายุ</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ชื่อระบบ</th><th>key</th><th>สิทธิ์</th><th>สถานะ</th>
                <th>เรียกล่าสุด</th><th>ครั้ง</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7}><div className="skeleton" style={{ height: 20 }} /></td></tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                    ยังไม่มี API key — กด “สร้าง key” เพื่อให้ระบบอื่นมาดึงข้อมูลได้
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    {r.description && (
                      <div className="muted" style={{ fontSize: 12 }}>{r.description}</div>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.masked}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {r.scopes.map((s) => (
                        <span
                          key={s}
                          className={`badge ${PII_SCOPES.includes(s as ApiScope) ? 'badge-warning' : 'badge-purple'}`}
                          title={SCOPE_LABEL_TH[s as ApiScope] ?? s}
                          style={{ fontSize: 11 }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[r.status].cls}`}>{STATUS_BADGE[r.status].label}</span></td>
                  <td style={{ fontSize: 12 }}>
                    {thaiDateTime(r.lastUsedAt)}
                    {r.lastUsedIp && (
                      <div className="muted mono" style={{ fontSize: 11 }}>{r.lastUsedIp}</div>
                    )}
                  </td>
                  <td className="num">{r.usageCount.toLocaleString('th-TH')}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <button className="chip" onClick={() => reveal(r)}>ดู</button>
                      <button
                        className="chip"
                        onClick={() => setEditing({
                          id: r.id, name: r.name, description: r.description,
                          scopes: r.scopes, expiresAt: r.expiresAt,
                        })}
                      >
                        แก้ไข
                      </button>
                      <button className="chip" onClick={() => rotate(r)}>สร้างรหัสใหม่</button>
                      <button className="chip" onClick={() => toggleActive(r)}>
                        {r.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <UsageGuide />

      {showNew && (
        <ApiKeyDialog
          onClose={() => setShowNew(false)}
          onDone={(created) => {
            setShowNew(false);
            load();
            if (created) {
              setRevealed({
                value: created.plain,
                title: `สร้าง key สำเร็จ · ${created.name}`,
                note: 'คัดลอกรหัสนี้ไปตั้งค่าในระบบปลายทาง — เปิดดูภายหลังได้ที่ปุ่ม “ดู” (จะถูกบันทึกไว้)',
              });
            }
          }}
        />
      )}

      {editing && (
        <ApiKeyDialog
          existing={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); }}
        />
      )}

      {revealed && (
        <RevealDialog
          value={revealed.value}
          title={revealed.title}
          note={revealed.note}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  );
}

/** วิธีเรียกใช้ — กันคำถามซ้ำจากผู้ดูแลระบบปลายทาง */
function UsageGuide() {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <IconKey width={18} height={18} />
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>วิธีให้ระบบอื่นเรียกใช้</h2>
      </div>

      <div className="stack" style={{ gap: 14, fontSize: 13 }}>
        <div>
          <div className="form-label" style={{ marginBottom: 4 }}>ส่ง key มากับ header</div>
          <pre className="mono" style={{ background: 'var(--skdw-bg)', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>
{`X-API-Key: sk_live_xxxxxxxx
# หรือ
Authorization: Bearer sk_live_xxxxxxxx`}
          </pre>
        </div>

        <div>
          <div className="form-label" style={{ marginBottom: 4 }}>ปลายทางที่เรียกได้</div>
          <pre className="mono" style={{ background: 'var(--skdw-bg)', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>
{`GET ${BASE_PATH}/api/public/v1/students   # ต้องมีสิทธิ์ students:read
    ?yearId=&grade=ป.6&classroom=2&status=studying&q=&page=1&pageSize=50

GET ${BASE_PATH}/api/public/v1/teachers   # ต้องมีสิทธิ์ teachers:read
    ?subjectGroup=&role=teacher&status=active&q=&yearId=&page=1&pageSize=50
    # แต่ละคนมี homerooms: [{gradeLevel, classroom}] = ห้องที่ประจำชั้น
    # ในปีนั้น (ค่าเริ่มต้น: ปีปัจจุบัน)

GET ${BASE_PATH}/api/public/v1/homerooms  # ครูประจำชั้นรายห้อง — ใช้สิทธิ์ teachers:read
    ?yearId=&grade=ป.6&classroom=2
    # ตอบทุกห้องที่มีนักเรียนในปีนั้น + รายชื่อครูประจำชั้น
    # และข้อมูลปีการศึกษา (วันเปิด–ปิด เทอม 1/เทอม 2)

GET ${BASE_PATH}/api/public/v1/me         # ตรวจสอบว่า key ใช้ได้ไหม + มีสิทธิ์อะไร

POST ${BASE_PATH}/api/public/v1/auth/verify   # ตรวจรหัสผ่าน (ล็อกอิน)
    # ต้องมีสิทธิ์ auth:students หรือ auth:teachers`}
          </pre>
        </div>

        <div>
          <div className="form-label" style={{ marginBottom: 4 }}>ตัวอย่าง — ดึงรายชื่อ</div>
          <pre className="mono" style={{ background: 'var(--skdw-bg)', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>
{`curl -H "X-API-Key: sk_live_xxxx" \\
  "http://localhost:3002${BASE_PATH}/api/public/v1/students?grade=ป.6&pageSize=100"`}
          </pre>
        </div>

        <div>
          <div className="form-label" style={{ marginBottom: 4 }}>ตัวอย่าง — ให้ระบบอื่นทำหน้าล็อกอิน</div>
          <pre className="mono" style={{ background: 'var(--skdw-bg)', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>
{`curl -X POST -H "X-API-Key: sk_live_xxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"role":"teacher","username":"T00116","password":"…"}' \\
  "http://localhost:3002${BASE_PATH}/api/public/v1/auth/verify"

# ถูก  -> 200 {"valid":true,"user":{
#           "code":"T00116","name":"…",
#           "role":"teacher-admin","active":true,"status":"active"}}
# ผิด  -> 401 {"valid":false,...}
# เดารหัสถี่ -> 429 (ล็อก 15 นาที หลังพลาด 5 ครั้ง)`}
          </pre>
        </div>

        <div className="alert alert-warning" style={{ fontSize: 12 }}>
          <strong>auth/verify ตรวจรหัสผ่านให้เท่านั้น ไม่ได้ออก token</strong> — ระบบปลายทาง
          ต้องไปสร้าง session ของตัวเอง (ตั้งใจไม่แจก token ของ SchoolOS เพราะจะต้องเอา{' '}
          <code className="mono">JWT_SECRET</code> ไปแชร์ = ปลอม token เป็นใครก็ได้)
          และ <strong>ต้องเช็ก <code className="mono">active</code> เอง</strong> — ครูที่ลาออกแล้ว
          หรือนักเรียนที่จบ/จำหน่ายไปแล้ว ยัง <code className="mono">valid:true</code> อยู่
          (รหัสผ่านถูกจริง) แต่ <code className="mono">active:false</code>
        </div>

        <div className="alert alert-info" style={{ fontSize: 12 }}>
          ข้อมูลที่ส่งออกเป็นรายชื่อ + ชั้น/ห้อง/เลขที่ เท่านั้น —
          <strong>ไม่มีรหัสผ่าน</strong>ในทุกกรณี ส่วน<strong>เลขบัตรประชาชน</strong>
          จะส่งก็ต่อเมื่อ key นั้นมีสิทธิ์ <code className="mono">students:pii</code> /{' '}
          <code className="mono">teachers:pii</code> และทุกครั้งจะถูกบันทึกไว้
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { useToast } from '@/components/Toast';

interface Log {
  id: number; actorLabel: string | null; actorRole: string | null;
  action: string; targetType: string; targetLabel: string | null;
  detail: string | null; ip: string | null; createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  reveal_password: 'ดูรหัสผ่าน', reveal_citizen_id: 'ดูเลขบัตร', reveal_income: 'ดูรายได้',
  create: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ', archive: 'ย้ายไปถังขยะ', restore: 'กู้คืน',
  import: 'นำเข้า', export: 'ส่งออก', login: 'เข้าสู่ระบบ',
  assign_homeroom: 'กำหนดครูประจำชั้น',
  create_api_key: 'สร้าง API key', reveal_api_key: 'ดู API key',
  rotate_api_key: 'สร้างรหัส API ใหม่', revoke_api_key: 'ปิดใช้งาน API key',
};
// Actions that disclosed sensitive data — highlighted amber in the table.
const REVEAL = new Set([
  'reveal_password', 'reveal_citizen_id', 'reveal_income', 'reveal_api_key',
]);

export default function AuditPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const pageSize = 50;

  const load = useCallback(async (p: number) => {
    try {
      const sp = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (action) sp.set('action', action);
      const res = await api<{ data: Log[]; total: number }>(`/api/users/audit?${sp}`);
      setRows(res.data); setTotal(res.total); setPage(p);
    } catch (e) { toast((e as Error).message, 'error'); }
  }, [action, toast]);

  useEffect(() => { load(1); }, [load]);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">บันทึกการใช้งาน (Audit Log)</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>บันทึกใคร/เมื่อไร/ดู-แก้ข้อมูลอ่อนไหวและรหัสผ่าน</p>
        </div>
        <select className="form-select" style={{ width: 180 }} value={action} onChange={(e) => setAction(e.target.value)} aria-label="กรองประเภท">
          <option value="">ทุกประเภท</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>ประเภท</th><th>เป้าหมาย</th><th>รายละเอียด</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleString('th-TH')}</td>
                  <td>{r.actorLabel ?? '-'} <span className="muted" style={{ fontSize: 12 }}>({r.actorRole})</span></td>
                  <td><span className={`badge ${REVEAL.has(r.action) ? 'badge-warning' : 'badge-purple'}`}>{ACTION_LABEL[r.action] ?? r.action}</span></td>
                  <td>{r.targetType}</td>
                  <td>{r.targetLabel ?? '-'}{r.detail ? <span className="muted" style={{ fontSize: 12 }}> · {r.detail}</span> : null}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.ip ?? '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>ยังไม่มีบันทึก</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="row-between" style={{ padding: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>ทั้งหมด {total.toLocaleString('th-TH')} รายการ</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => load(page - 1)}>ก่อนหน้า</button>
            <span className="mono" style={{ fontSize: 13 }}>{page} / {pages}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => load(page + 1)}>ถัดไป</button>
          </div>
        </div>
      </div>
    </div>
  );
}

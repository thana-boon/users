'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconSearch } from '@/components/Icons';

interface Row {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; nickname: string | null;
  gender: string | null; status: string;
  exitType: string | null; exitReason: string | null; exitDate: string | null;
  exitYear: number | null; gradeLevel: string | null; classroom: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  withdrawn: 'จำหน่าย/ลาออก', graduated: 'จบการศึกษา',
};

/** นักเรียนเก่า — look up students who have already left (จบ/จำหน่าย/ลาออก). */
export default function FormerStudentsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const pageSize = 25;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (q) sp.set('q', q);
      if (status) sp.set('status', status);
      const res = await api<{ data: Row[]; total: number }>(`/api/users/students/former?${sp}`);
      setRows(res.data);
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [q, status, toast]);

  // debounce search + filter changes
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(1), 300);
    return () => clearTimeout(debounceRef.current);
  }, [q, status, load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">นักเรียนเก่า</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            ค้นดูข้อมูลนักเรียนที่จบการศึกษาหรือจำหน่าย/ลาออกไปแล้ว
          </p>
        </div>
        <Link className="btn btn-secondary btn-sm" href="/users/students">ทะเบียนนักเรียน</Link>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--skdw-muted)' }}><IconSearch width={18} height={18} /></span>
            <input
              className="form-input"
              style={{ paddingLeft: 38 }}
              placeholder="ค้นหารหัส / ชื่อ / นามสกุล / ชื่อเล่น"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="ค้นหานักเรียนเก่า"
            />
          </div>
          <select className="form-select" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="กรองสถานะ">
            <option value="">ทั้งหมด (จบ + จำหน่าย)</option>
            <option value="graduated">จบการศึกษา</option>
            <option value="withdrawn">จำหน่าย/ลาออก</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>เพศ</th><th>สถานะ</th>
                <th>ชั้นที่ออก</th><th>ปีที่ออก</th><th>ประเภท</th><th>วันที่ออก</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={9}><div className="skeleton" style={{ height: 20 }} /></td></tr>
                ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }} className="muted">
                  ไม่พบนักเรียนเก่าที่ค้นหา
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.studentCode}</td>
                  <td>{r.prefix ?? ''}{r.firstName} {r.lastName}{r.nickname ? ` (${r.nickname})` : ''}</td>
                  <td>{r.gender ?? '-'}</td>
                  <td>
                    <span className="badge" style={{ background: 'var(--skdw-bg)', fontSize: 11 }}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td>{r.gradeLevel ? `${r.gradeLevel}${r.classroom ? `/${r.classroom}` : ''}` : '-'}</td>
                  <td className="mono">{r.exitYear ?? '-'}</td>
                  <td>{r.exitType ?? '-'}</td>
                  <td>{r.exitDate ?? '-'}</td>
                  <td><Link href={`/users/students/${r.id}`} className="chip">ดู</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="row-between" style={{ padding: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>ทั้งหมด {total.toLocaleString('th-TH')} คน</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>ก่อนหน้า</button>
            <span style={{ fontSize: 13 }} className="mono">{page} / {pages}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pages || loading} onClick={() => load(page + 1)}>ถัดไป</button>
          </div>
        </div>
      </div>
    </div>
  );
}

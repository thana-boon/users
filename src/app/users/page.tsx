'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { formatThaiDate } from '@/lib/thai';

interface Dashboard {
  activeYear: { id: number; year: number } | null;
  totalStudents: number;
  totalTeachers: number;
  byGrade: { grade: string; count: number }[];
  byGender: { gender: string; count: number }[];
  byReligion: { religion: string; count: number }[];
  newestStudents: {
    id: number; studentCode: string; firstName: string; lastName: string;
    admissionDate: string | null; gradeLevel: string | null;
  }[];
  teachersBySubject: { subjectGroup: string; count: number }[];
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 44px', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <div style={{ background: 'var(--skdw-bg)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--skdw-purple)', borderRadius: 999, transition: 'width .3s ease' }} />
      </div>
      <span className="mono" style={{ fontSize: 13, textAlign: 'right' }}>{count.toLocaleString('th-TH')}</span>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>('/api/users/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ width: 220, height: 28 }} />
        <div className="grid-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
        </div>
      </div>
    );
  }

  const maxGrade = Math.max(1, ...data.byGrade.map((g) => g.count));
  const maxSubject = Math.max(1, ...data.teachersBySubject.map((s) => s.count));
  const totalGender = Math.max(1, data.byGender.reduce((a, b) => a + b.count, 0));

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">ภาพรวม</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            ปีการศึกษาปัจจุบัน: <b>{data.activeYear ? data.activeYear.year : 'ยังไม่กำหนด'}</b>
          </p>
        </div>
        <Link href="/users/students" className="btn btn-secondary btn-sm">ดูนักเรียนทั้งหมด</Link>
      </div>

      {/* Stat cards */}
      <div className="grid-4">
        <div className="stat">
          <span className="stat-label">นักเรียนทั้งหมด</span>
          <span className="stat-value">{data.totalStudents.toLocaleString('th-TH')}</span>
          <span className="stat-sub">คน (ปีปัจจุบัน)</span>
        </div>
        <div className="stat">
          <span className="stat-label">ครูทั้งหมด</span>
          <span className="stat-value">{data.totalTeachers.toLocaleString('th-TH')}</span>
          <span className="stat-sub">คน</span>
        </div>
        {data.byGender.map((g) => (
          <div className="stat" key={g.gender}>
            <span className="stat-label">เพศ{g.gender}</span>
            <span className="stat-value">{g.count.toLocaleString('th-TH')}</span>
            <span className="stat-sub">{Math.round((g.count / totalGender) * 100)}% ของนักเรียน</span>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* By grade */}
        <div className="card">
          <h2 className="section-title">จำนวนนักเรียนตามชั้น</h2>
          <div className="stack" style={{ gap: 10 }}>
            {data.byGrade.map((g) => (
              <BarRow key={g.grade} label={g.grade} count={g.count} max={maxGrade} />
            ))}
            {data.byGrade.length === 0 && <p className="muted">ยังไม่มีข้อมูล</p>}
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {/* Religion */}
          <div className="card">
            <h2 className="section-title">จำนวนตามศาสนา</h2>
            <div className="stack" style={{ gap: 8 }}>
              {data.byReligion.map((r) => (
                <div key={r.religion} className="row-between" style={{ padding: '4px 0' }}>
                  <span>{r.religion}</span>
                  <span className="chip mono">{r.count.toLocaleString('th-TH')}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Teachers by subject */}
          <div className="card">
            <h2 className="section-title">ครูตามกลุ่มสาระ</h2>
            <div className="stack" style={{ gap: 10 }}>
              {data.teachersBySubject.slice(0, 8).map((s) => (
                <BarRow key={s.subjectGroup} label={s.subjectGroup.replace('กลุ่มสาระการเรียนรู้', '')} count={s.count} max={maxSubject} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Newest students */}
      <div className="card">
        <h2 className="section-title">นักเรียนเพิ่งเข้าใหม่</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ชั้น</th><th>วันที่เข้าเรียน</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.newestStudents.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.studentCode}</td>
                  <td>{s.firstName} {s.lastName}</td>
                  <td>{s.gradeLevel ?? '-'}</td>
                  <td>{formatThaiDate(s.admissionDate) || '-'}</td>
                  <td><Link href={`/users/students/${s.id}`} className="chip">ดู</Link></td>
                </tr>
              ))}
              {data.newestStudents.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>ยังไม่มีข้อมูล</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { formatThaiDate } from '@/lib/thai';

interface GenderBucket { male: number; female: number; other: number; count: number }
interface RoomBucket extends GenderBucket { classroom: string }
interface GradeBucket extends GenderBucket { grade: string; rooms: RoomBucket[] }

interface Dashboard {
  activeYear: { id: number; year: number } | null;
  totalStudents: number;
  totalTeachers: number;
  byGrade: GradeBucket[];
  byGender: { gender: string; count: number }[];
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

/** A stacked male/female bar. `w` is the shared width scale (px per student). */
function GenderBar({ b, max, height = 12 }: { b: GenderBucket; max: number; height?: number }) {
  const pct = (n: number) => (max ? `${(n / max) * 100}%` : '0%');
  return (
    <div
      style={{ display: 'flex', width: '100%', height, borderRadius: 999, overflow: 'hidden', background: 'var(--skdw-bg)' }}
      title={`ชาย ${b.male} · หญิง ${b.female}${b.other ? ` · อื่น ๆ ${b.other}` : ''}`}
    >
      <div style={{ width: pct(b.male), background: 'var(--gender-male)', transition: 'width .3s ease' }} />
      <div style={{ width: pct(b.female), background: 'var(--gender-female)', transition: 'width .3s ease' }} />
      {b.other > 0 && <div style={{ width: pct(b.other), background: 'var(--skdw-muted)', transition: 'width .3s ease' }} />}
    </div>
  );
}

function GradeChart({ grades }: { grades: GradeBucket[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...grades.map((g) => g.count));

  if (grades.length === 0) return <p className="muted">ยังไม่มีข้อมูล</p>;

  return (
    <div className="stack" style={{ gap: 6 }}>
      {/* Legend */}
      <div className="row" style={{ gap: 16, marginBottom: 4, fontSize: 12 }}>
        <span className="row" style={{ gap: 6 }}>
          <i style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--gender-male)', display: 'inline-block' }} /> ชาย
        </span>
        <span className="row" style={{ gap: 6 }}>
          <i style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--gender-female)', display: 'inline-block' }} /> หญิง
        </span>
      </div>

      {grades.map((g) => {
        const isOpen = open === g.grade;
        return (
          <div key={g.grade} className="stack" style={{ gap: 6 }}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : g.grade)}
              aria-expanded={isOpen}
              style={{
                display: 'grid', gridTemplateColumns: '16px 78px 1fr 52px', alignItems: 'center', gap: 8,
                background: 'none', border: 'none', padding: '4px 2px', cursor: 'pointer', width: '100%',
                textAlign: 'left', color: 'inherit', borderRadius: 8,
              }}
              title="คลิกเพื่อดูรายห้อง"
            >
              <span className="muted" style={{ fontSize: 11, transition: 'transform .2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
              <span style={{ fontSize: 13 }}>{g.grade}</span>
              <GenderBar b={g} max={max} />
              <span className="mono" style={{ fontSize: 13, textAlign: 'right' }}>{g.count.toLocaleString('th-TH')}</span>
            </button>

            {isOpen && (
              <div className="stack" style={{ gap: 6, paddingLeft: 24, marginBottom: 6 }}>
                {g.rooms.map((r) => (
                  <div key={r.classroom} style={{ display: 'grid', gridTemplateColumns: '78px 1fr 52px', alignItems: 'center', gap: 8 }}>
                    <span className="muted" style={{ fontSize: 12 }}>ห้อง {r.classroom}</span>
                    <GenderBar b={r} max={max} height={9} />
                    <span className="mono muted" style={{ fontSize: 12, textAlign: 'right' }}>{r.count.toLocaleString('th-TH')}</span>
                  </div>
                ))}
                {g.rooms.length === 0 && <span className="muted" style={{ fontSize: 12 }}>ไม่มีข้อมูลห้อง</span>}
              </div>
            )}
          </div>
        );
      })}
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
        {/* By grade — stacked male/female, click a grade to see its rooms */}
        <div className="card">
          <h2 className="section-title">จำนวนนักเรียนตามชั้น</h2>
          <p className="muted" style={{ margin: '-4px 0 10px', fontSize: 12 }}>คลิกที่ชั้นเพื่อดูรายห้อง</p>
          <GradeChart grades={data.byGrade} />
        </div>

        {/* Teachers by subject */}
        <div className="card">
          <h2 className="section-title">ครูตามกลุ่มสาระ</h2>
          <div className="stack" style={{ gap: 10 }}>
            {data.teachersBySubject.slice(0, 8).map((s) => (
              <BarRow key={s.subjectGroup} label={s.subjectGroup.replace('กลุ่มสาระการเรียนรู้', '')} count={s.count} max={maxSubject} />
            ))}
            {data.teachersBySubject.length === 0 && <p className="muted">ยังไม่มีข้อมูล</p>}
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

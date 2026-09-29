'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { TeacherProfile, type TeacherMe } from './TeacherProfile';
import { StudentProfile, type StudentMe } from './StudentProfile';

/**
 * "ข้อมูลของฉัน" — one URL for both audiences.
 *
 * The page does not decide which form to show; the server does. GET
 * /api/users/me answers with `audience`, the record, and `canEdit` +
 * `closedReason` for the school-wide switch an admin flips at /users/settings.
 * Everything here is display: the API enforces the same policy again on write.
 */

export interface SelfEnvelope {
  audience: 'teacher' | 'student';
  canEdit: boolean;
  closedReason: string | null;
}

export default function MyProfile() {
  const [data, setData] = useState<(SelfEnvelope & Record<string, unknown>) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<SelfEnvelope & Record<string, unknown>>('/api/users/me')
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  // A phone on school wifi drops a request now and then — say so, and offer
  // the retry instead of leaving a red box and a reload as the only way out.
  if (error && !data) {
    return (
      <div className="alert alert-error" role="alert">
        <div>โหลดข้อมูลไม่สำเร็จ: {error}</div>
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={load}>
          ลองอีกครั้ง
        </button>
      </div>
    );
  }
  if (!data) return <ProfileSkeleton />;

  return data.audience === 'teacher' ? (
    <TeacherProfile me={data as unknown as TeacherMe} reload={load} />
  ) : (
    <StudentProfile me={data as unknown as StudentMe} reload={load} />
  );
}

/** The page's own shape while it loads, so nothing jumps when it arrives. */
function ProfileSkeleton() {
  return (
    <div className="stack" style={{ gap: 20 }} aria-busy="true" aria-label="กำลังโหลดข้อมูลของฉัน">
      <div className="card me-hero">
        <div className="me-photo skeleton" style={{ height: 'auto' }} />
        <div className="me-hero-body stack" style={{ gap: 10 }}>
          <div className="skeleton" style={{ height: 26, width: '70%' }} />
          <div className="skeleton" style={{ width: '40%' }} />
          <div className="skeleton" style={{ height: 22, width: '55%' }} />
        </div>
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="card stack" style={{ gap: 14 }}>
          <div className="skeleton" style={{ height: 20, width: '45%' }} />
          <div className="grid-2">
            {[0, 1, 2, 3].map((j) => <div key={j} className="skeleton" style={{ height: 44 }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

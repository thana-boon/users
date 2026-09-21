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
    api<SelfEnvelope & Record<string, unknown>>('/api/users/me')
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="skeleton" style={{ height: 240 }} />;

  return data.audience === 'teacher' ? (
    <TeacherProfile me={data as unknown as TeacherMe} reload={load} />
  ) : (
    <StudentProfile me={data as unknown as StudentMe} reload={load} />
  );
}

'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconShield } from '@/components/Icons';

/**
 * DEV login. In production this screen is replaced by real SSO; the module
 * only ever consumes the resulting JWT. Here we mint a mock teacher-admin
 * token via /api/auth/dev-token so you can explore the module locally.
 */
function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const denied = params.get('denied') === '1';
  const next = params.get('next') || '/users';
  const [role, setRole] = useState<'teacher-admin' | 'teacher' | 'student'>('teacher-admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/dev-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, sub: '0', name: 'ผู้ดูแลระบบ (Dev)' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      if (role === 'teacher-admin') router.push(next);
      else setError('ได้ token บทบาท ' + role + ' แล้ว — แต่โมดูลนี้เปิดให้เฉพาะ teacher-admin เท่านั้น');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--skdw-bg)' }}>
      <div className="card" style={{ maxWidth: 400, width: '100%' }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <div aria-hidden style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--skdw-purple)', color: 'var(--skdw-gold)', display: 'grid', placeItems: 'center', fontWeight: 800, fontFamily: 'var(--font-en)' }}>S</div>
          <div>
            <div style={{ fontWeight: 700 }}>SchoolOS</div>
            <div className="muted" style={{ fontSize: 13 }}>ข้อมูลนักเรียนและครู</div>
          </div>
        </div>

        <div className="alert alert-info" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16 }}>
          <IconShield width={18} height={18} />
          <span style={{ fontSize: 13 }}>
            โหมดพัฒนา: จำลอง SSO ด้วย mock JWT เข้าถึงโมดูลได้เฉพาะ <b>teacher-admin</b>
          </span>
        </div>

        {denied && (
          <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}>
            สิทธิ์ไม่เพียงพอ — โมดูลนี้เฉพาะ teacher-admin เท่านั้นที่เข้าได้
          </div>
        )}

        <label className="form-label" htmlFor="role">เลือก role (สำหรับทดสอบ)</label>
        <select id="role" className="form-select" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="teacher-admin">teacher-admin (เข้าได้)</option>
          <option value="teacher">teacher (ทดสอบ—ถูกปฏิเสธ)</option>
          <option value="student">student (ทดสอบ—ถูกปฏิเสธ)</option>
        </select>

        {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={signIn} disabled={loading}>
          {loading ? 'กำลังเข้า…' : 'เข้าสู่ระบบ'}
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

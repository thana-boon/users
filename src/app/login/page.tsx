'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconShield } from '@/components/Icons';

/**
 * Login screen for this module.
 *
 * PRIMARY path (works on any server, incl. production): a real credential form —
 * รหัสครู (teacher_code) + password -> /api/auth/teacher-login, which checks the
 * DB and mints the SSO token. Only a `teacher-admin` carries `users:write`, so a
 * plain teacher logs in but is then bounced by RBAC (message shown).
 *
 * DEV path (only when NEXT_PUBLIC_ENABLE_DEV_TOKEN=true): a quick mock-role
 * login via /api/auth/dev-token, for standalone testing without any DB account.
 *
 * In real production the SSO portal owns login; this page is the standalone /
 * fallback entry.
 */

const DEV_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEV_TOKEN === 'true';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const denied = params.get('denied') === '1';
  const next = params.get('next') || '/users';

  const [teacherCode, setTeacherCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/teacher-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_code: teacherCode.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      // teacher-admin gets users:write; a plain teacher gets a token but no access.
      const isAdmin = data.user?.role === 'teacher-admin';
      if (isAdmin) router.push(next);
      else setError('เข้าสู่ระบบสำเร็จ แต่บัญชีนี้ไม่มีสิทธิ์ users:write — โมดูลนี้เปิดให้เฉพาะผู้ดูแล (teacher-admin) เท่านั้น');
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

        {denied && (
          <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}>
            สิทธิ์ไม่เพียงพอ — โมดูลนี้ต้องมีสิทธิ์ users:write (ผู้ดูแล) เท่านั้นที่เข้าได้
          </div>
        )}

        <form onSubmit={signIn}>
          <label className="form-label" htmlFor="teacher_code">รหัสครู</label>
          <input
            id="teacher_code"
            className="form-input"
            style={{ width: '100%' }}
            value={teacherCode}
            onChange={(e) => setTeacherCode(e.target.value)}
            placeholder="เช่น T00001"
            autoComplete="username"
            autoFocus
          />

          <label className="form-label" htmlFor="password" style={{ marginTop: 12 }}>รหัสผ่าน</label>
          <input
            id="password"
            className="form-input"
            style={{ width: '100%' }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 16 }}
            disabled={loading || !teacherCode.trim() || !password}
          >
            {loading ? 'กำลังเข้า…' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        {DEV_ENABLED && <DevQuickLogin next={next} onError={setError} />}
      </div>
    </div>
  );
}

/** Dev-only mock login: pick a role, mint a token, no DB account needed. */
function DevQuickLogin({ next, onError }: { next: string; onError: (m: string | null) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function dev(role: 'teacher' | 'student', permissions: string[]) {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch('/api/auth/dev-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, permissions, sub: 'DEV', name: 'ผู้ดูแลระบบ (Dev)' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'dev-token ไม่สำเร็จ');
      if (permissions.includes('users:write')) router.push(next);
      else onError('ได้ token แล้ว — แต่โมดูลนี้เปิดให้เฉพาะผู้มีสิทธิ์ users:write เท่านั้น');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed var(--skdw-border, #ddd)' }}>
      <div className="alert alert-info" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
        <IconShield width={18} height={18} />
        <span style={{ fontSize: 13 }}>โหมดพัฒนา: เข้าใช้งานด้วย mock JWT โดยไม่ต้องมีบัญชีใน DB</span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => dev('teacher', ['users:read', 'users:write'])}>
          Dev admin (เข้าได้)
        </button>
        <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => dev('teacher', [])}>
          Dev ครู (ถูกปฏิเสธ)
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

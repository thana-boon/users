'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withBase } from '@/lib/client';
import { USERS_WRITE } from '@/lib/permissions';

/**
 * The credential form itself — only ever rendered once the server has
 * established that nobody is signed in yet (see page.tsx).
 *
 * รหัสครู (teacher_code) + password -> /api/auth/teacher-login, which checks the
 * DB and issues the platform session. Access to THIS module is decided by the
 * `users:write` permission, never by the DB role string: middleware gates on the
 * permission, so anything else here would be a second, disagreeing authority.
 */

export interface LoginFormProps {
  /** Where to go once signed in. Already validated server-side. */
  next: string;
  /** Bounced back by middleware: signed in, but without `users:write`. */
  denied: boolean;
  /** SessionGuard sent us here because the idle window (or the 8h cap) ran out. */
  expired: boolean;
  /** Who is signed in right now, when that session lacks `users:write`. */
  signedInAs: string | null;
}

export default function LoginForm({ next, denied, expired, signedInAs }: LoginFormProps) {
  const router = useRouter();

  const [teacherCode, setTeacherCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Did the session we just minted actually get into this module?
   *
   * Asks the same /api/auth/session probe the rest of the platform uses, so the
   * answer comes from the token's own `permissions` claim. Same-origin, so the
   * cookie rides along by itself. If the probe cannot be reached we do NOT block
   * the user: navigate and let middleware — the real gate — decide.
   */
  async function canEnterModule(): Promise<boolean> {
    try {
      const res = await fetch(withBase('/api/auth/session'));
      const data = await res.json();
      if (!data?.valid) return true; // nothing useful learned; let middleware rule
      return Boolean(data.user?.permissions?.includes(USERS_WRITE));
    } catch {
      return true;
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(withBase('/api/auth/teacher-login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_code: teacherCode.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เข้าสู่ระบบไม่สำเร็จ');

      if (await canEnterModule()) {
        router.push(next);
        router.refresh(); // the server page above must re-read the new cookie
      } else {
        setError(
          'เข้าสู่ระบบสำเร็จ แต่บัญชีนี้ไม่มีสิทธิ์ users:write — โมดูลนี้เปิดให้เฉพาะผู้ดูแล (teacher-admin) เท่านั้น',
        );
      }
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

        {expired && !denied && (
          <div className="alert alert-warning" style={{ marginBottom: 16, fontSize: 13 }}>
            หมดเวลาการใช้งาน — ระบบออกจากระบบให้อัตโนมัติเพราะไม่มีการใช้งานสักพัก
            กรุณาเข้าสู่ระบบใหม่อีกครั้ง
          </div>
        )}

        {denied && (
          <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}>
            สิทธิ์ไม่เพียงพอ — โมดูลนี้ต้องมีสิทธิ์ users:write (ผู้ดูแล) เท่านั้นที่เข้าได้
            {signedInAs && (
              <>
                <br />
                กำลังเข้าสู่ระบบในชื่อ <strong>{signedInAs}</strong> — เข้าสู่ระบบด้วยบัญชีผู้ดูแลด้านล่างเพื่อสลับบัญชี
              </>
            )}
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
      </div>
    </div>
  );
}

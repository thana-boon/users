'use client';

import { useState } from 'react';
import { withBase } from '@/lib/client';
import { confirmLeave } from '@/lib/useUnsavedChanges';
import { IconLogout, IconShield } from './Icons';

/**
 * The frame around /users/me.
 *
 * Deliberately NOT AppShell: that shell is the records module — a sidebar of
 * twenty admin pages, every one of which a plain teacher is refused. Here there
 * is exactly one page, so the chrome is a header and nothing else.
 *
 * `staffMode` is what turns this into a MODE rather than a separate app. An
 * admin (or a moderator, for the student pages) lands here as themselves and
 * can step back into the module with one click; the button is absent for
 * everyone else, because for them there is no other mode to be in.
 */
export function MeShell({
  name,
  initial,
  hasPhoto,
  staffMode,
  signedOutUrl,
  children,
}: {
  name: string;
  initial: string;
  hasPhoto: boolean;
  /** Which staff mode this person can switch back to, if any. */
  staffMode: 'admin' | 'moderator' | null;
  /** Where signing out lands — the platform portal, built server-side. */
  signedOutUrl: string;
  children: React.ReactNode;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);

  async function logout() {
    // Asked BEFORE the session is killed — staying must still leave a way to save.
    if (!(await confirmLeave())) return;
    await fetch(withBase('/api/auth/logout'), { method: 'POST' });
    window.location.href = signedOutUrl;
  }

  // Built phone-first: most teachers and students open this from a phone, so
  // the header is one compact row there and only spreads out on a wide screen.
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <a href="#me-main" className="skip-link">ข้ามไปยังเนื้อหา</a>
      <header className="me-header">
        <div aria-hidden className="me-logo">S</div>
        <div style={{ lineHeight: 1.15, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>SchoolOS</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>ข้อมูลของฉัน</div>
        </div>

        <div className="spacer" style={{ flex: 1 }} />

        <div className="row" style={{ gap: 8 }}>
          {/* A plain <a>, not <Link>: the two modes are separate root layouts,
              one of them reached through a rewrite. A full load is also the
              honest thing here — the admin shell re-reads the session it is
              gated on. */}
          {staffMode && (
            <a
              // A moderator also goes to /users: middleware forwards them to
              // the first page their grants open.
              href="/users"
              className="mode-btn"
              title="กลับไปหน้าจัดการข้อมูล"
            >
              <IconShield width={16} height={16} />
              <span className="hide-mobile">สลับเป็นโหมดผู้ดูแล</span>
              <span className="only-mobile">ผู้ดูแล</span>
            </a>
          )}
          <div className="me-avatar" title={name}>
            {hasPhoto && !photoFailed ? (
              <img
                src={withBase('/api/users/me/photo')}
                alt={name}
                onError={() => setPhotoFailed(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span aria-hidden>{initial || '?'}</span>
            )}
          </div>
          <span style={{ fontSize: 13, opacity: 0.9 }} className="hide-mobile">{name}</span>
          <button
            type="button"
            className="mode-btn"
            onClick={logout}
            title="ออกจากระบบ"
            aria-label="ออกจากระบบ"
          >
            <IconLogout width={16} height={16} />
            <span className="hide-mobile">ออกจากระบบ</span>
          </button>
        </div>
      </header>

      <main id="me-main" tabIndex={-1} className="me-main">
        <div style={{ maxWidth: 880, margin: '0 auto' }}>{children}</div>
      </main>

      <style>{`
        .me-header {
          height: 64px; background: var(--skdw-purple); color: #fff;
          display: flex; align-items: center; gap: 12px;
          padding: 0 var(--space-6); box-shadow: var(--shadow-md);
          position: sticky; top: 0; z-index: var(--z-sticky);
        }
        .me-logo {
          width: 34px; height: 34px; border-radius: 9px; flex: none;
          background: var(--skdw-gold); color: var(--skdw-dark);
          display: grid; place-items: center; font-weight: 800; font-family: var(--font-en);
        }
        .me-avatar {
          width: 36px; height: 36px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
          background: var(--skdw-gold); color: var(--skdw-dark);
          display: grid; place-items: center; font-weight: 700; font-size: 15px;
          border: 1.5px solid rgba(255,255,255,0.55);
        }
        .me-main { flex: 1; padding: var(--space-8); padding-bottom: 96px; }
        .me-main:focus { outline: none; }
        .mode-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          min-height: 36px; min-width: 36px;
          padding: 6px 12px; border-radius: 999px; cursor: pointer;
          background: rgba(255,255,255,0.12); color: #fff;
          border: 1px solid rgba(255,255,255,0.35);
          font-family: inherit; font-size: 13px; line-height: 1.2;
          transition: background var(--transition-fast);
        }
        .mode-btn:hover { background: rgba(255,255,255,0.24); }
        .mode-btn:focus-visible { outline-color: var(--skdw-gold); }
        .only-mobile { display: none; }
        @media (pointer: coarse) { .mode-btn { min-height: 44px; min-width: 44px; } }
        @media (max-width: 720px) {
          .hide-mobile { display: none; }
          .only-mobile { display: inline; }
          .me-header { height: 56px; padding: 0 var(--space-3) 0 var(--space-4); gap: 10px; }
          .me-logo { width: 30px; height: 30px; border-radius: 8px; }
          .me-main { padding: var(--space-4) var(--space-3) 120px; }
        }
      `}</style>
    </div>
  );
}


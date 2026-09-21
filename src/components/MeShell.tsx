'use client';

import { useState } from 'react';
import { withBase } from '@/lib/client';
import { IconLogout, IconShield } from './Icons';

/**
 * The frame around /users/me.
 *
 * Deliberately NOT AppShell: that shell is the records module — a sidebar of
 * twenty admin pages, every one of which a plain teacher is refused. Here there
 * is exactly one page, so the chrome is a header and nothing else.
 *
 * `isAdmin` is what turns this into a MODE rather than a separate app. An
 * admin lands here as themselves and can step back into the module with one
 * click; the button is absent for everyone else, because for them there is no
 * other mode to be in.
 */
export function MeShell({
  name,
  initial,
  hasPhoto,
  isAdmin,
  signedOutUrl,
  children,
}: {
  name: string;
  initial: string;
  hasPhoto: boolean;
  isAdmin: boolean;
  /** Where signing out lands — the platform portal, built server-side. */
  signedOutUrl: string;
  children: React.ReactNode;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);

  async function logout() {
    await fetch(withBase('/api/auth/logout'), { method: 'POST' });
    window.location.href = signedOutUrl;
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          height: 64, background: 'var(--skdw-purple)', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '0 var(--space-6)', boxShadow: 'var(--shadow-md)',
          position: 'sticky', top: 0, zIndex: 200,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 34, height: 34, borderRadius: 9,
            background: 'var(--skdw-gold)', color: 'var(--skdw-dark)',
            display: 'grid', placeItems: 'center', fontWeight: 800,
            fontFamily: 'var(--font-en)',
          }}
        >
          S
        </div>
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontWeight: 700 }}>SchoolOS</div>
          <div style={{ fontSize: 11, opacity: 0.8 }}>ข้อมูลของฉัน</div>
        </div>

        <div className="spacer" style={{ flex: 1 }} />

        <div className="row" style={{ gap: 10 }}>
          {/* A plain <a>, not <Link>: the two modes are separate root layouts,
              one of them reached through a rewrite. A full load is also the
              honest thing here — the admin shell re-reads the session it is
              gated on. */}
          {isAdmin && (
            <a href="/users" className="mode-btn" title="กลับไปหน้าจัดการข้อมูลนักเรียนและครู">
              <IconShield width={14} height={14} />
              <span className="hide-mobile">สลับเป็นโหมดผู้ดูแล</span>
              <span className="only-mobile">ผู้ดูแล</span>
            </a>
          )}
          <div
            title={name}
            style={{
              width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
              background: 'var(--skdw-gold)', color: 'var(--skdw-dark)',
              display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 15,
              border: '1.5px solid rgba(255,255,255,0.55)',
            }}
          >
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
          <button type="button" className="mode-btn" onClick={logout} title="ออกจากระบบ">
            <IconLogout width={14} height={14} />
            <span className="hide-mobile">ออกจากระบบ</span>
          </button>
        </div>
      </header>

      <main style={{ flex: 1, padding: 'var(--space-8)', paddingBottom: 96 }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>{children}</div>
      </main>

      <style>{`
        .mode-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 999px; cursor: pointer;
          background: rgba(255,255,255,0.12); color: #fff;
          border: 1px solid rgba(255,255,255,0.35);
          font-family: inherit; font-size: 13px; line-height: 1.2;
          transition: background var(--transition-fast);
        }
        .mode-btn:hover { background: rgba(255,255,255,0.24); }
        .only-mobile { display: none; }
        @media (max-width: 720px) {
          .hide-mobile { display: none; }
          .only-mobile { display: inline; }
        }
      `}</style>
    </div>
  );
}


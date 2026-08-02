'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { withBase } from '@/lib/client';

/**
 * The visible half of the idle timeout.
 *
 * The server slides the session forward on every request (src/middleware.ts) and
 * publishes the resulting deadline in a readable `schoolos_session_exp` cookie.
 * This component counts down against that cookie and does two things:
 *
 *   1. keeps a *working* session alive — someone typing into a long form makes
 *      no requests, so without this their half-finished work would be thrown
 *      away by a timeout they had no way to see coming;
 *   2. warns before the logout actually happens, with a way to stay in.
 *
 * The countdown reads a cookie rather than polling an endpoint on purpose:
 * asking the server "am I still logged in?" IS activity, and a session that
 * refreshes itself every few seconds can never idle out at all.
 */

/** How long before the deadline the warning appears. */
const WARN_BEFORE_MS = 2 * 60_000;

/** Refresh silently once activity is seen and less than this much time is left. */
const RENEW_UNDER_MS = 10 * 60_000;

/** Floor between two silent refreshes, so a busy mouse is not a request storm. */
const RENEW_COOLDOWN_MS = 60_000;

const EXP_COOKIE = 'schoolos_session_exp';

function readExpiryCookie(): number | null {
  const hit = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${EXP_COOKIE}=`));
  if (!hit) return null;
  const n = Number(hit.slice(EXP_COOKIE.length + 1));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function SessionGuard({ expiresAt }: { expiresAt: number }) {
  // Server-rendered deadline is the starting point; the cookie takes over as
  // soon as anything renews it. Both are absolute epoch ms, so the later of the
  // two always wins. Held in a ref, not state, so updating it does not tear down
  // and restart the one-second interval below.
  const deadline = useRef(expiresAt);
  const [remaining, setRemaining] = useState(() => expiresAt - Date.now());
  const [renewing, setRenewing] = useState(false);
  const lastActivity = useRef(Date.now());
  const lastRenew = useRef(0);
  const endedRef = useRef(false);

  /** Session is over: bin the page and send them to a login that says why. */
  const end = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Best-effort cookie clear; navigate either way so the UI cannot linger
    // showing data behind a dead session.
    fetch(withBase('/api/auth/logout'), { method: 'POST', keepalive: true })
      .catch(() => {})
      .finally(() => {
        // NOT withBase(): that is for API/asset/public-file paths, which the
        // gateway delivers prefixed and next.config's beforeFiles rewrites strip
        // again. PAGE routes genuinely live at /users/*, so prefixing this one
        // would ask for /users/users/login — a 404 with no route behind it.
        window.location.href = '/users/login?expired=1';
      });
  }, []);

  const renew = useCallback(async () => {
    if (endedRef.current) return;
    setRenewing(true);
    lastRenew.current = Date.now();
    try {
      const res = await fetch(withBase('/api/auth/refresh'), { method: 'POST' });
      if (res.status === 401) return end(); // hit the absolute cap
      if (!res.ok) return;
      const data = (await res.json()) as { expiresAt?: number };
      if (data.expiresAt) {
        deadline.current = Math.max(deadline.current, data.expiresAt);
        setRemaining(deadline.current - Date.now());
      }
    } catch {
      // Offline or the server is down. Say nothing — the countdown keeps
      // running and the warning will come back around.
    } finally {
      setRenewing(false);
    }
  }, [end]);

  // Note what counts as "still here". Passive listeners: this must never make
  // scrolling or typing feel heavier.
  useEffect(() => {
    const seen = () => {
      lastActivity.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, seen, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, seen);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      deadline.current = Math.max(deadline.current, readExpiryCookie() ?? 0);

      const left = deadline.current - Date.now();
      setRemaining(left);
      if (left <= 0) return end();

      // Someone is clearly still working, and the window is getting short:
      // extend it quietly rather than interrupting them with the dialog.
      const activeRecently = Date.now() - lastActivity.current < RENEW_COOLDOWN_MS;
      const cooledDown = Date.now() - lastRenew.current > RENEW_COOLDOWN_MS;
      if (left > WARN_BEFORE_MS && left < RENEW_UNDER_MS && activeRecently && cooledDown) {
        void renew();
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [end, renew]);

  if (remaining > WARN_BEFORE_MS) return null;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="session-warn-title">
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="card-header" id="session-warn-title">
          กำลังจะออกจากระบบอัตโนมัติ
        </div>
        <div className="card-pad stack" style={{ gap: 18 }}>
          <div style={{ lineHeight: 1.6 }}>
            ไม่มีการใช้งานสักพักแล้ว ระบบจะออกจากระบบให้อัตโนมัติในอีก{' '}
            <strong className="mono" aria-live="polite">{mmss(remaining)}</strong> นาที
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              กด “อยู่ต่อ” เพื่อใช้งานต่อ — งานที่ยังกรอกค้างไว้จะไม่หาย
            </div>
          </div>
          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={end}>
              ออกจากระบบเลย
            </button>
            <button className="btn btn-primary btn-sm" onClick={renew} disabled={renewing} autoFocus>
              {renewing ? 'กำลังต่อเวลา…' : 'อยู่ต่อ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

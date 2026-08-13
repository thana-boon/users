import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import {
  absoluteTimeoutMs,
  clearSessionCookies,
  reissueSession,
  sessionExpiresAt,
  setSessionCookies,
} from '@/lib/jwt';
import { corsPreflight, withCors } from '@/lib/cors';
import { platformHomeUrl } from '@/lib/platform';

export const runtime = 'nodejs';

/**
 * Slide the idle window forward on demand — what the "อยู่ต่อ" button in the
 * expiry warning calls, and what SessionGuard calls quietly while someone is
 * typing into a long form (activity that a page making no requests would
 * otherwise hide from the server).
 *
 * Deliberately OUTSIDE the middleware's /api/users prefix so it also answers a
 * session without `users:write`: a student session has to be able to stay alive
 * too, and this endpoint grants nothing the caller does not already hold.
 *
 * Cross-origin too, for the same reason it exists at all. The middleware that
 * slides the window on activity only matches /users/* and /api/users/*, so work
 * done in ANOTHER SchoolOS service is invisible to it — an hour of marking in
 * Track would otherwise time the user out mid-sentence. GET /api/auth/session
 * deliberately does not renew (a consumer polling it would keep a walked-away
 * session alive forever, which is exactly what the idle window exists to
 * prevent); renewal has to be something a consumer asks for when it has seen
 * real user activity, which is this.
 *
 * `login_at` carries over unchanged, so this extends a session up to the
 * absolute cap and not one second past it — at the cap the new `exp` equals the
 * old one and the countdown keeps running down to zero.
 */
async function handler(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    // Already over. Clear the stale cookies and tell the client to stop
    // counting and send the user to the portal — `loginUrl` for the same reason
    // GET /api/auth/session carries it: this is the other moment a consumer has
    // to decide where a user goes, and its own login form is the wrong answer.
    const res = NextResponse.json(
      { error: 'หมดเวลาการใช้งาน', loginUrl: platformHomeUrl() },
      { status: 401 },
    );
    clearSessionCookies(res.cookies);
    return res;
  }

  const { token, claims } = await reissueSession(session);
  const res = NextResponse.json({
    ok: true,
    expiresAt: sessionExpiresAt(claims),
    /** When the hard cap lands, whatever activity happens in between. */
    absoluteEndsAt: session.login_at + absoluteTimeoutMs(),
  });
  setSessionCookies(res.cookies, token, claims);
  return res;
}

// Wrapped so the 401 carries the headers too — otherwise a cross-origin caller
// sees an opaque failure and cannot tell "session is over, go to login" from
// "the network is down, try again".
export const POST = withCors(handler);
export const OPTIONS = corsPreflight;

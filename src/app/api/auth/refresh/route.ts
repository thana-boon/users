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
 * `login_at` carries over unchanged, so this extends a session up to the
 * absolute cap and not one second past it — at the cap the new `exp` equals the
 * old one and the countdown keeps running down to zero.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    // Already over. Clear the stale cookies and tell the client to stop
    // counting and send the user to the login page.
    const res = NextResponse.json({ error: 'หมดเวลาการใช้งาน' }, { status: 401 });
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

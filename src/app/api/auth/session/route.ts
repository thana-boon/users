import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { SSO_COOKIE, sessionExpiresAt, verifySession } from '@/lib/jwt';
import { corsPreflight, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

/**
 * GET /api/auth/session — "is this browser already signed in, and as whom?"
 *
 * The SSO probe every other SchoolOS service (Arena, Grad, Timetable, Track,
 * กีฬาสี) calls before it shows a login screen of its own. Cross-origin and
 * credentialed, so the caller MUST send `credentials: 'include'` and its origin
 * must be listed in SSO_ALLOWED_ORIGINS.
 *
 * Answers 200 either way — "nobody is logged in" is a fact, not an error, and a
 * 401 would just make every caller special-case it. Read the `valid` field.
 *
 * Returns claims only, straight out of the token: no database round trip, so a
 * page can wait on this before rendering.
 */
async function handler(req: NextRequest) {
  // The cross-service cookie first, then this app's own (or a Bearer token) —
  // they carry the same JWT, but a caller that was told about `sso_session` is
  // entitled to have that be the one that counts.
  const session =
    (await verifySession(req.cookies.get(SSO_COOKIE)?.value)) ??
    (await getSessionFromRequest(req));

  if (!session) {
    // `session: null` is the shape this endpoint answered before SSO existed.
    // Kept alongside `valid` so anything already calling it keeps working.
    return NextResponse.json({ valid: false, user: null, session: null });
  }

  const user = {
    sub: session.sub,
    role: session.role,
    name: session.name ?? null,
    code: session.code ?? null,
    permissions: session.permissions,
  };

  return NextResponse.json({
    valid: true,
    user,
    /**
     * When this session dies (epoch ms) — idle window or the 8h absolute cap,
     * whichever is sooner. A consumer can cache the answer until then instead of
     * probing on every page.
     */
    expiresAt: sessionExpiresAt(session),
    session: user,
  });
}

export const GET = withCors(handler);
export const OPTIONS = corsPreflight;

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clearSessionCookies } from '@/lib/jwt';
import { corsPreflight, isAllowedOrigin, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

/**
 * Sign out of the WHOLE platform. Both cookies are dropped here — they are
 * written together and they die together (see lib/jwt.ts) — so the next session
 * probe from every other SchoolOS service answers `valid:false`.
 *
 * Two ways in, because a consumer service on another origin needs a different
 * one than this app's own UI:
 *
 *   GET  — a plain link. A top-level navigation sends the cookie with no CORS
 *          involved at all, which is the only thing that works when the user
 *          should end up somewhere afterwards. Redirects to `?next=`.
 *   POST — fetch() from an allowlisted origin, for a consumer that would rather
 *          clear its own state and stay put. Same clearing, no redirect.
 *
 * On the GET: a logout link can be fired by anything that can make the browser
 * issue a GET (an <img> on a hostile page). That is a nuisance — it signs the
 * user out — not a compromise: it grants no access and reveals nothing. Paying
 * for it with a POST-only endpoint would mean no cross-service logout at all,
 * which is the far worse bargain on shared classroom machines.
 */

/** Where to send the browser once the cookies are gone. */
function returnTo(req: NextRequest): URL {
  const raw = req.nextUrl.searchParams.get('next');
  const fallback = new URL('/users/login', req.nextUrl.origin);
  if (!raw) return fallback;

  // A path inside this app.
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return new URL(raw, req.nextUrl.origin);
  }

  // Back to the service that sent the user here — but only one already trusted
  // enough to read a logged-in user's identity. Without this check the logout
  // link is an open redirect wearing the school's own domain, which is exactly
  // the thing a phishing page wants to borrow.
  try {
    const url = new URL(raw);
    if (isAllowedOrigin(url.origin)) return url;
  } catch {
    // not a URL at all — fall through
  }
  return fallback;
}

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(returnTo(req));
  clearSessionCookies(res.cookies);
  // A cached logout is a logout that stops working the second time.
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

async function handler(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res.cookies);
  return res;
}

export const POST = withCors(handler);
export const OPTIONS = corsPreflight;

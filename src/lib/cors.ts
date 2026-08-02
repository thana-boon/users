import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Cross-origin access for the SSO endpoints under /api/auth/*.
 *
 * Every SchoolOS service runs on its own port (Users 3002, Arena 3017, ...), so
 * a call made from another service's browser is always cross-ORIGIN — and it has
 * to carry the session cookie, which means `Access-Control-Allow-Credentials:
 * true`. A credentialed response may never answer `*`, so the caller's exact
 * Origin is echoed back, and only after it matches SSO_ALLOWED_ORIGINS verbatim.
 *
 * Applied per route rather than in middleware: middleware runs in the edge
 * runtime, where Next inlines `process.env` at BUILD time (the same reason
 * BASE_PATH is a Dockerfile ARG). The allowlist has to be changeable by editing
 * .env and restarting, like every other setting here — and these routes declare
 * `runtime = 'nodejs'`, where process.env is read live.
 */

/** Origins allowed to make credentialed calls. Empty (the default) = none. */
function allowlist(): string[] {
  return (process.env.SSO_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Exact match only. Deliberately not a prefix/suffix test: `startsWith` would
 * let `http://localhost:3017.evil.com` through, and the whole point of the
 * allowlist is that it decides who may read a logged-in user's identity.
 *
 * Exported because the same question — "is this one of ours?" — decides where
 * the logout link is allowed to send the browser back to, not just which
 * fetch() may read a response.
 */
export function isAllowedOrigin(origin: string | null): origin is string {
  return !!origin && allowlist().includes(origin.replace(/\/+$/, ''));
}

/**
 * Stamp the CORS headers onto a response the handler already built.
 *
 * `Vary: Origin` goes on even when the origin is refused, so no cache between
 * here and the browser can hand one service's permissive response to another.
 */
export function applyCors(res: NextResponse, req: NextRequest): NextResponse {
  const vary = res.headers.get('Vary');
  if (!vary) res.headers.set('Vary', 'Origin');
  else if (!/\borigin\b/i.test(vary)) res.headers.set('Vary', `${vary}, Origin`);

  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) return res; // same-origin callers need none of this
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
}

/**
 * Preflight answer, exported as the `OPTIONS` handler of each SSO route. The
 * login POST sends `Content-Type: application/json`, which is not a
 * CORS-safelisted value, so the browser always asks permission first.
 */
export function corsPreflight(req: NextRequest): NextResponse {
  const res = applyCors(new NextResponse(null, { status: 204 }), req);
  if (res.headers.has('Access-Control-Allow-Origin')) {
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    // Echo what was asked for, so a consumer that adds a header of its own does
    // not need a change here. Headers are not a credential and the Origin has
    // already been checked above.
    res.headers.set(
      'Access-Control-Allow-Headers',
      req.headers.get('access-control-request-headers') ?? 'Content-Type',
    );
    res.headers.set('Access-Control-Max-Age', '600');
  }
  return res;
}

/**
 * Wrap a route handler so EVERY response it can return carries the headers —
 * including the 400s and 429s it returns early. Without them the browser hides
 * the response body and the caller sees an opaque network error instead of
 * "รหัสผ่านไม่ถูกต้อง".
 */
export function withCors(
  handler: (req: NextRequest) => Promise<NextResponse>,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req) => applyCors(await handler(req), req);
}

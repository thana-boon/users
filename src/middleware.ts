import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  readPlatformSession,
  hasPermission,
  renewSession,
  setSessionCookies,
  USERS_WRITE,
} from '@/lib/jwt';
import { platformHomeUrl, publicOrigin } from '@/lib/platform';

/**
 * Edge middleware - the first, fail-closed RBAC gate.
 *
 * Protected surfaces (this module needs the `users:write` permission):
 *   /users/**            - UI
 *   /api/users/**        - REST API
 *
 * Public:
 *   /api/auth/**         - login endpoints
 *   /users/login         - local login page (rewritten to src/app/login —
 *                          the gateway only routes /users/* to this app)
 *   static/next assets
 *
 * A request with no token, an invalid token, or one lacking `users:write` is
 * rejected here before any handler runs. API -> 401/403 JSON. UI -> the portal
 * when there is no session to speak of, this module's login page when there is
 * one that simply is not allowed in (see below — the two are different problems
 * and want different answers).
 */

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Behind the gateway, asset/API requests carry the BASE_PATH prefix (e.g.
  // /users/_next/*, /users/api/*). next.config.mjs rewrites strip it again —
  // but middleware runs BEFORE rewrites, so classify on the inner path here.
  // Page routes genuinely live at /users/* and must NOT be stripped.
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  let path = pathname;
  if (base) {
    if (
      path.startsWith(`${base}/_next/`) ||
      path.startsWith(`${base}/mediapipe/`) ||
      path === `${base}/icon.png`
    ) {
      return NextResponse.next(); // public static assets
    }
    if (path.startsWith(`${base}/api/`)) path = path.slice(base.length);
  }

  const isProtectedUi =
    (path === '/users' || path.startsWith('/users/')) &&
    path !== '/users/login'; // public: the login page lives under /users too
  const isProtectedApi = path.startsWith('/api/users');
  if (!isProtectedUi && !isProtectedApi) return NextResponse.next();

  // Either cookie counts, so a user who signed in through another SchoolOS
  // service arrives here already authenticated instead of meeting a second
  // login form. See readPlatformSession().
  const resolved = await readPlatformSession(
    req.cookies,
    req.headers.get('authorization'),
  );

  if (!resolved || !hasPermission(resolved.session, USERS_WRITE)) {
    if (isProtectedApi) {
      const status = !resolved ? 401 : 403;
      const msg = !resolved
        ? 'ต้องเข้าสู่ระบบก่อนใช้งาน'
        : 'ไม่มีสิทธิ์เข้าถึงโมดูลนี้ (ต้องมีสิทธิ์ users:write)';
      return NextResponse.json({ error: msg }, { status });
    }

    // No session at all — signed out, or the idle window ran out while the
    // browser was closed. Out to the portal, which is where a sign-in that works
    // for the whole platform lives; `next` rides along so it can send them back
    // here afterwards if it knows how.
    if (!resolved) {
      return NextResponse.redirect(platformHomeUrl({ next: pathname }));
    }

    // Signed in, but this account cannot enter the module. NOT the portal: that
    // answers a question they have already answered, and would leave them
    // clicking back and forth with nothing telling them why. The login page says
    // who they are signed in as and offers an admin sign-in instead.
    //
    // Absolute, and NOT off req.nextUrl: behind the gateway this app thinks it
    // lives at https://0.0.0.0:3002 (its bind address), which is what broke the
    // logout redirect — see publicOrigin(). Middleware cannot answer with a bare
    // path the way that route now does; Next re-parses the Location header with
    // no base and throws on a relative one.
    const url = new URL('/users/login', publicOrigin(req.headers, req.nextUrl.origin));
    url.searchParams.set('next', pathname);
    url.searchParams.set('denied', '1');
    return NextResponse.redirect(url);
  }

  const { session, token, source } = resolved;

  const res = NextResponse.next();

  // Signed in elsewhere on the platform: `sso_session` is here but this app's
  // own pair is not. Write all three back from the SAME token — no re-signing,
  // so the deadline does not move — which both stops the two names from drifting
  // apart and hands SessionGuard the readable expiry cookie it counts down
  // against. Only for 'sso': a Bearer API client has no use for cookies.
  if (source === 'sso') setSessionCookies(res.cookies, token, session);

  // Idle timeout, activity half: every authenticated request through this
  // module pushes the deadline back. renewSession() no-ops unless the session is
  // past the halfway mark (so a page load's burst of requests re-signs once) and
  // refuses to move the absolute cap. A browser left alone makes no requests, so
  // its window simply runs out — which is the whole point.
  const renewed = await renewSession(session);
  if (renewed) setSessionCookies(res.cookies, renewed.token, renewed.claims);
  return res;
}

export const config = {
  matcher: ['/users/:path*', '/api/users/:path*'],
};

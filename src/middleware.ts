import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession, hasPermission, USERS_WRITE, SESSION_COOKIE } from '@/lib/jwt';

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
 * rejected here before any handler runs. UI -> redirect to /login; API ->
 * 401/403 JSON.
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
      path === `${base}/icon.svg`
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

  const token =
    req.cookies.get(SESSION_COOKIE)?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  const session = await verifySession(token);

  if (!session || !hasPermission(session, USERS_WRITE)) {
    if (isProtectedApi) {
      const status = !session ? 401 : 403;
      const msg = !session
        ? 'ต้องเข้าสู่ระบบก่อนใช้งาน'
        : 'ไม่มีสิทธิ์เข้าถึงโมดูลนี้ (ต้องมีสิทธิ์ users:write)';
      return NextResponse.json({ error: msg }, { status });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/users/login';
    url.searchParams.set('next', pathname);
    if (session) url.searchParams.set('denied', '1');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/users/:path*', '/api/users/:path*'],
};

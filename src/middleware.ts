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
 *   /api/auth/**         - login + dev-token endpoints
 *   /login               - local login page (dev / standalone testing)
 *   static/next assets
 *
 * A request with no token, an invalid token, or one lacking `users:write` is
 * rejected here before any handler runs. UI -> redirect to /login; API ->
 * 401/403 JSON.
 */

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtectedUi = pathname === '/users' || pathname.startsWith('/users/');
  const isProtectedApi = pathname.startsWith('/api/users');
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
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    if (session) url.searchParams.set('denied', '1');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/users/:path*', '/api/users/:path*'],
};

import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE, type SessionClaims } from './jwt';

/**
 * Read the session two ways so both browser (cookie) and API clients
 * (Authorization: Bearer) work. Everything fails closed to null.
 */

function bearer(header: string | null): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : undefined;
}

/** For Route Handlers / middleware that hold a NextRequest. */
export async function getSessionFromRequest(
  req: NextRequest,
): Promise<SessionClaims | null> {
  const token =
    req.cookies.get(SESSION_COOKIE)?.value ??
    bearer(req.headers.get('authorization'));
  return verifySession(token);
}

/** For Server Components / Server Actions. */
export async function getSession(): Promise<SessionClaims | null> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const token =
    cookieStore.get(SESSION_COOKIE)?.value ??
    bearer(headerStore.get('authorization'));
  return verifySession(token);
}

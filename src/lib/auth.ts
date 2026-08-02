import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { readPlatformSession, type ResolvedSession, type SessionClaims } from './jwt';

/**
 * Reading "who is signed in" from a Server Component or a Route Handler.
 *
 * Both are thin wrappers over readPlatformSession(), which is the single place
 * that decides — it accepts this app's own cookie, the cross-service
 * `sso_session` written when the user signed in through another SchoolOS
 * service, or an `Authorization: Bearer` token for API clients. Everything fails
 * closed to null.
 *
 * The `resolved*` variants additionally say WHERE the token came from; callers
 * that only need the claims should use getSession() / getSessionFromRequest().
 */

/** For Route Handlers / middleware that hold a NextRequest. */
export async function resolveSessionFromRequest(
  req: NextRequest,
): Promise<ResolvedSession | null> {
  return readPlatformSession(req.cookies, req.headers.get('authorization'));
}

/** For Server Components / Server Actions. */
export async function resolveSession(): Promise<ResolvedSession | null> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return readPlatformSession(cookieStore, headerStore.get('authorization'));
}

export async function getSessionFromRequest(
  req: NextRequest,
): Promise<SessionClaims | null> {
  return (await resolveSessionFromRequest(req))?.session ?? null;
}

export async function getSession(): Promise<SessionClaims | null> {
  return (await resolveSession())?.session ?? null;
}

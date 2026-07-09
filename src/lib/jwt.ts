import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * SchoolOS SSO token contract (shared with schoolos-portal).
 *
 * The portal signs a JWT after login and drops it in the `schoolos_token`
 * cookie; every app-service (this module included) only *verifies* it — it
 * never re-issues. HS256 with a `JWT_SECRET` that is identical byte-for-byte
 * across all services. `jose` is used so the same verify runs in edge
 * middleware and node routes.
 *
 * This module keeps a small local login (dev-token / teacher-login) that mints
 * a token with the SAME contract, so it can be tested standalone without the
 * portal. Business logic only ever reads the claims below.
 */

export type AppRole = 'teacher' | 'student';

export interface SessionClaims extends JWTPayload {
  sub: string; // username = teacher_code / student_code (e.g. "T00116")
  role: AppRole;
  name?: string;
  permissions: string[]; // e.g. ["users:read", "users:write"]
  login_at: number; // wall-clock of the ORIGINAL login (ms) — never slides
  code?: string; // optional label kept for local login (usually == sub)
}

/** Cookie the portal (and our local login) sets. */
export const SESSION_COOKIE = 'schoolos_token';

/** Hard cap from the original login, independent of the sliding `exp`. */
export const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

/** Permission that grants access to this (admin-only) Records module. */
export const USERS_READ = 'users:read';
export const USERS_WRITE = 'users:write';

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set.');
  return new TextEncoder().encode(s);
}

function parseExpiry(): string {
  return process.env.JWT_EXPIRES_IN ?? '8h';
}

/** True if the session carries `perm`. Null-safe / fail-closed. */
export function hasPermission(
  session: SessionClaims | null,
  perm: string,
): boolean {
  return !!session && session.permissions.includes(perm);
}

/**
 * Mint a token with the SSO contract. Used only by this module's local login
 * (dev-token / teacher-login) — the portal signs its own with the same shape.
 */
export async function signSession(claims: {
  sub: string;
  role: AppRole;
  name?: string;
  permissions: string[];
  code?: string;
  login_at?: number;
}): Promise<string> {
  return new SignJWT({
    role: claims.role,
    name: claims.name,
    code: claims.code,
    permissions: claims.permissions,
    login_at: claims.login_at ?? Date.now(),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(parseExpiry())
    .sign(secret());
}

/**
 * Verify a token. Returns claims on success, or null on any failure
 * (fail-closed): bad signature, expired `exp`, unknown role, missing/expired
 * `login_at` (past the 8h absolute cap).
 */
export async function verifySession(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
    });

    const role = payload.role;
    if (role !== 'teacher' && role !== 'student') return null;
    if (!payload.sub) return null;
    if (typeof payload.login_at !== 'number') return null;
    if (Date.now() - payload.login_at > ABSOLUTE_TIMEOUT_MS) return null;

    return {
      ...payload,
      sub: payload.sub,
      role,
      permissions: Array.isArray(payload.permissions)
        ? (payload.permissions as string[])
        : [],
      login_at: payload.login_at,
    } as SessionClaims;
  } catch {
    return null;
  }
}

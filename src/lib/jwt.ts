import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * Mock JWT auth for dev. HMAC (HS256) with a shared secret from env.
 * Uses `jose` so the same verify works in edge middleware and node routes.
 * Swap the token *source* for real SSO at deploy time — the verify/claims
 * contract below stays the same, so business logic never changes.
 */

export type AppRole = 'student' | 'teacher' | 'teacher-admin';

export interface SessionClaims extends JWTPayload {
  sub: string; // user id
  role: AppRole;
  name?: string;
  code?: string; // student_code / teacher_code
}

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set.');
  return new TextEncoder().encode(s);
}

const ISSUER = () => process.env.JWT_ISSUER ?? 'schoolos';

function parseExpiry(): string {
  return process.env.JWT_EXPIRES_IN ?? '8h';
}

export async function signSession(
  claims: Omit<SessionClaims, 'iat' | 'exp' | 'iss'>,
): Promise<string> {
  return new SignJWT({ role: claims.role, name: claims.name, code: claims.code })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(claims.sub))
    .setIssuedAt()
    .setIssuer(ISSUER())
    .setExpirationTime(parseExpiry())
    .sign(secret());
}

/** Verify a token. Returns claims on success, or null on any failure (fail-closed). */
export async function verifySession(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER(),
    });
    const role = payload.role as AppRole | undefined;
    if (!payload.sub || !role) return null;
    if (!['student', 'teacher', 'teacher-admin'].includes(role)) return null;
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'schoolos_session';

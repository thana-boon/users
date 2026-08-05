import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { getSessionFromRequest } from './auth';
import { hasPermission, USERS_WRITE, type SessionClaims } from './jwt';
import { extractApiKey, hashApiKey, hasScope, type ApiScope } from './apikey';
import { clientIp } from './ip';
import { checkBudget, rateLimit } from './rate-limit';
import type { ApiKey } from '@/db/schema';

/** Per-credential request budget for the public API (fixed window). */
const API_RATE_LIMIT = 600;
const API_RATE_WINDOW_MS = 60_000;

/**
 * Per-IP budget for requests that fail to authenticate. Charged only on a
 * denial, never on a call that presented a working credential.
 *
 * WHY not per request: every other SchoolOS service reaches us server-side over
 * the docker bridge, so they all arrive as ONE address (172.18.0.1). A budget
 * that counted successful calls too would have the whole platform share a
 * single bucket and throttle each other — and one of the things behind it is
 * /api/public/v1/auth/verify, so the symptom would be users being told their
 * password is wrong. Same failure the login routes just had; same fix.
 */
const API_FAIL_LIMIT = 100;
const API_FAIL_WINDOW_MS = 60_000;

function rateLimited(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: { code: 'rate_limited', message: 'คำขอถี่เกินไป ลองใหม่อีกครั้งภายหลัง' } },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  );
}

function throttled(bucketKey: string): NextResponse | null {
  const r = rateLimit(bucketKey, API_RATE_LIMIT, API_RATE_WINDOW_MS);
  return r.allowed ? null : rateLimited(r.retryAfterSec);
}

/**
 * Auth for the public `/api/public/v1/*` surface.
 *
 * NOTE: this path is deliberately OUTSIDE the `/api/users/*` middleware matcher
 * — middleware demands a `users:write` *session*, which a machine caller will
 * never have. So this guard is the ONLY gate on these routes and must stay
 * fail-closed: every branch that is not a positive match returns a denial.
 *
 * Two credentials are accepted:
 *   1. API key   (X-API-Key / Bearer sk_live_…) — the real integration path.
 *   2. Session   (schoolos_token cookie / Bearer <jwt>) — so a logged-in admin
 *      can open an endpoint in the browser to check it. Requires `users:write`,
 *      i.e. exactly the people who can mint keys anyway, so it grants no new
 *      reach. This is what "ใช้ auth ได้ทั้งระบบ" buys: one URL, either
 *      credential.
 */

export type ApiActor =
  | { kind: 'key'; key: ApiKey; label: string }
  | { kind: 'session'; session: SessionClaims; label: string };

export type ApiGuard =
  | { ok: true; actor: ApiActor }
  | { ok: false; response: NextResponse };

function deny(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * The public surface's error envelope, `{ error: { code, message } }` — note
 * this is NOT the `{ error: string }` shape that lib/http.ts returns for the
 * admin UI's own API. Exported so routes can emit 400/404 in the same shape the
 * guard uses.
 */
export function apiError(status: number, code: string, message: string): NextResponse {
  return deny(status, code, message);
}

/**
 * Require a credential carrying `scope`.
 *
 * An API key is checked in this order — active → not revoked → not expired →
 * scope — so a disabled key reports "ถูกปิดใช้งาน" rather than a misleading
 * "ไม่มีสิทธิ์".
 */
export async function requireApiScope(
  req: NextRequest,
  scope: ApiScope,
): Promise<ApiGuard> {
  // Per-IP budget guards the pre-auth work (a DB lookup per presented key), so
  // an unauthenticated flood of bogus keys can't hammer the database. Checked
  // here, charged only when the credential turns out to be bad — see
  // API_FAIL_LIMIT for why counting good calls too was the wrong shape.
  const failKey = `api-fail-ip:${clientIp(req) ?? 'unknown'}`;
  const ipGate = checkBudget(failKey, API_FAIL_LIMIT);
  if (!ipGate.allowed) {
    return { ok: false, response: rateLimited(ipGate.retryAfterSec) };
  }

  /** Deny, and charge this address for having presented a bad credential. */
  const denyAuth = (status: number, code: string, message: string): ApiGuard => {
    rateLimit(failKey, API_FAIL_LIMIT, API_FAIL_WINDOW_MS);
    return { ok: false, response: deny(status, code, message) };
  };

  const presented = extractApiKey(req.headers);

  if (presented) {
    // Matched by hash only; the stored AES copy is never touched here.
    const hash = hashApiKey(presented);
    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, hash) });

    if (!key) return denyAuth(401, 'invalid_key', 'API key ไม่ถูกต้อง');
    if (!key.isActive || key.revokedAt) {
      return denyAuth(403, 'key_revoked', 'API key นี้ถูกปิดใช้งานแล้ว');
    }
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      return denyAuth(403, 'key_expired', 'API key นี้หมดอายุแล้ว');
    }
    if (!hasScope(key.scopes, scope)) {
      return denyAuth(403, 'insufficient_scope', `API key นี้ไม่มีสิทธิ์ ${scope}`);
    }

    // Per-key budget so one integration cannot exhaust the DB pool / CPU.
    const limited = throttled(`api-key:${key.id}`);
    if (limited) return { ok: false, response: limited };

    void touchKey(key.id, clientIp(req));
    return { ok: true, actor: { kind: 'key', key, label: `apikey:${key.name}` } };
  }

  // Fall back to an admin browser session.
  const session = await getSessionFromRequest(req);
  if (!session) {
    return denyAuth(401, 'unauthorized', 'ต้องส่ง API key (X-API-Key) หรือเข้าสู่ระบบก่อน');
  }
  if (!hasPermission(session, USERS_WRITE)) {
    return denyAuth(403, 'forbidden', 'ไม่มีสิทธิ์เข้าถึง API นี้');
  }
  return {
    ok: true,
    actor: { kind: 'session', session, label: session.sub },
  };
}

/**
 * Record that a key was used. Fire-and-forget: usage telemetry must never fail
 * or slow the caller's request, so errors are swallowed (same contract as
 * recordAudit). Not awaited by the guard.
 */
async function touchKey(id: number, ip: string | null): Promise<void> {
  try {
    await db
      .update(apiKeys)
      .set({
        lastUsedAt: new Date(),
        lastUsedIp: ip,
        usageCount: sql`${apiKeys.usageCount} + 1`,
      })
      .where(eq(apiKeys.id, id));
  } catch (err) {
    console.error('[apiauth] failed to record key usage', id, err);
  }
}

/**
 * The standard 403 for an additive scope the actor is missing. Exported so the
 * routes that gate on `:pii` / `:photo` *after* a successful `:read` guard all
 * emit the same `insufficient_scope` shape callers already handle.
 */
export function insufficientScope(scope: ApiScope): NextResponse {
  return deny(403, 'insufficient_scope', `API key นี้ไม่มีสิทธิ์ ${scope}`);
}

/** True if the actor may receive decrypted PII (needs the additive `:pii` scope). */
export function actorHasScope(actor: ApiActor, scope: ApiScope): boolean {
  // A `users:write` admin session already reveals PII through the normal UI,
  // so it satisfies any scope; an API key gets only what it was granted.
  if (actor.kind === 'session') return true;
  return hasScope(actor.key.scopes, scope);
}

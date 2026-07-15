import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { getSessionFromRequest } from './auth';
import { hasPermission, USERS_WRITE, type SessionClaims } from './jwt';
import { extractApiKey, hashApiKey, hasScope, type ApiScope } from './apikey';
import type { ApiKey } from '@/db/schema';

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

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? null;
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
  const presented = extractApiKey(req.headers);

  if (presented) {
    // Matched by hash only; the stored AES copy is never touched here.
    const hash = hashApiKey(presented);
    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, hash) });

    if (!key) return { ok: false, response: deny(401, 'invalid_key', 'API key ไม่ถูกต้อง') };
    if (!key.isActive || key.revokedAt) {
      return { ok: false, response: deny(403, 'key_revoked', 'API key นี้ถูกปิดใช้งานแล้ว') };
    }
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      return { ok: false, response: deny(403, 'key_expired', 'API key นี้หมดอายุแล้ว') };
    }
    if (!hasScope(key.scopes, scope)) {
      return {
        ok: false,
        response: deny(403, 'insufficient_scope', `API key นี้ไม่มีสิทธิ์ ${scope}`),
      };
    }

    void touchKey(key.id, clientIp(req));
    return { ok: true, actor: { kind: 'key', key, label: `apikey:${key.name}` } };
  }

  // Fall back to an admin browser session.
  const session = await getSessionFromRequest(req);
  if (!session) {
    return {
      ok: false,
      response: deny(401, 'unauthorized', 'ต้องส่ง API key (X-API-Key) หรือเข้าสู่ระบบก่อน'),
    };
  }
  if (!hasPermission(session, USERS_WRITE)) {
    return {
      ok: false,
      response: deny(403, 'forbidden', 'ไม่มีสิทธิ์เข้าถึง API นี้'),
    };
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

/** True if the actor may receive decrypted PII (needs the additive `:pii` scope). */
export function actorHasScope(actor: ApiActor, scope: ApiScope): boolean {
  // A `users:write` admin session already reveals PII through the normal UI,
  // so it satisfies any scope; an API key gets only what it was granted.
  if (actor.kind === 'session') return true;
  return hasScope(actor.key.scopes, scope);
}

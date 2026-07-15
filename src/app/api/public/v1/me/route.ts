import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { extractApiKey, hashApiKey, API_SCOPES } from '@/lib/apikey';
import { getSessionFromRequest } from '@/lib/auth';
import { hasPermission, USERS_WRITE } from '@/lib/jwt';
import { ok, handleError } from '@/lib/http';
import { keyStatus } from '@/lib/services/apikeys';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/me — introspection ("ตรวจสอบ").
 *
 * Answers "is this credential valid, and what may it do?" so an integrator can
 * self-diagnose without touching real data. Intentionally NOT built on
 * requireApiScope: this endpoint must be able to *describe* a key that is
 * expired or revoked rather than reject it, which is exactly the case someone
 * hits this endpoint to debug.
 *
 * It never echoes the key back — only its prefix, scopes and status.
 */
export async function GET(req: NextRequest) {
  try {
    const presented = extractApiKey(req.headers);

    if (presented) {
      const key = await db.query.apiKeys.findFirst({
        where: eq(apiKeys.keyHash, hashApiKey(presented)),
      });
      if (!key) {
        return ok(
          { authenticated: false, error: { code: 'invalid_key', message: 'API key ไม่ถูกต้อง' } },
          { status: 401 },
        );
      }
      const status = keyStatus(key);
      return ok({
        authenticated: status === 'active',
        type: 'api_key',
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes ?? [],
        status,
        expiresAt: key.expiresAt?.toISOString() ?? null,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        usageCount: key.usageCount,
      });
    }

    const session = await getSessionFromRequest(req);
    if (!session) {
      return ok(
        {
          authenticated: false,
          error: { code: 'unauthorized', message: 'ไม่พบ API key หรือ session' },
        },
        { status: 401 },
      );
    }
    return ok({
      authenticated: true,
      type: 'session',
      sub: session.sub,
      name: session.name ?? null,
      role: session.role,
      // An admin session can reach every endpoint (see requireApiScope), so it
      // reports the full scope list to keep this response comparable to a key's.
      scopes: hasPermission(session, USERS_WRITE) ? [...API_SCOPES] : [],
    });
  } catch (err) {
    return handleError(err);
  }
}

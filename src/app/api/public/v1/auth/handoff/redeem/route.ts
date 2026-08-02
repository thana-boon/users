import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiScope } from '@/lib/apiauth';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { consumeHandoffCode } from '@/lib/handoff';
import { absoluteTimeoutMs, sessionExpiresAt } from '@/lib/jwt';

export const runtime = 'nodejs';

/**
 * POST /api/public/v1/auth/handoff/redeem — spend a one-time code for the
 * identity behind it.
 *
 * The back-channel half of GET /api/auth/handoff: the user's browser collected a
 * code from us and posted it to the consumer's server, and that server — holding
 * an API key we issued — asks who it belongs to. Nothing here trusts the browser
 * with anything: the code alone is worthless without the key, and the key alone
 * cannot conjure a code.
 *
 * Like /auth/verify this issues no token. The consumer mints its own session
 * from the answer, so `JWT_SECRET` never leaves this app.
 *
 * Auth: `auth:handoff`, AND the key must name the audience the code was minted
 * for (api_keys.handoff_audience) — otherwise any handoff-capable integration
 * could spend a code the user's browser collected for a different service.
 */

const bodySchema = z.object({
  code: z.string().min(1).max(200),
});

/**
 * Failures of the CODE (400) are kept apart from failures of the KEY (403), and
 * both apart from `/auth/verify`'s `invalid_credentials` — a consumer must be
 * able to tell "that code is stale, ask the browser for another" from "this
 * integration is misconfigured, call an admin" without reading Thai.
 */
const CODE_ERRORS: Record<string, string> = {
  invalid_code: 'โค้ดนี้ไม่ถูกต้อง',
  expired_code: 'โค้ดนี้หมดอายุแล้ว (อายุ 60 วินาที)',
  used_code: 'โค้ดนี้ถูกใช้ไปแล้ว',
  audience_mismatch: 'โค้ดนี้ออกให้ระบบอื่น ไม่ใช่ระบบของ key นี้',
};

export async function POST(req: NextRequest) {
  const guard = await requireApiScope(req, 'auth:handoff');
  if (!guard.ok) return guard.response;

  try {
    const body = bodySchema.parse(await req.json());

    // An API key may only redeem for the audience it was configured with. A key
    // that has the scope but no audience is a half-finished setup, and failing
    // closed here is what makes the audience binding worth anything. An admin
    // session (the "open it in the browser to check it" path) is not bound —
    // it already holds every power this endpoint could hand out.
    let expected: string | null = null;
    if (guard.actor.kind === 'key') {
      expected = guard.actor.key.handoffAudience;
      if (!expected) {
        return apiError(
          403,
          'key_audience_unset',
          'key นี้ยังไม่ได้ระบุระบบปลายทาง (audience) — ให้แอดมินตั้งค่าในหน้า API Manager',
        );
      }
    }

    const result = consumeHandoffCode(body.code, expected);

    if (!result.ok) {
      // Worth a row: a redeem that fails is either a broken integration or
      // someone spending codes that are not theirs, and neither shows up
      // anywhere else — the successful path is the one that looks routine.
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: 'login',
        targetType: 'auth',
        targetLabel: `handoff · ${result.reason}`,
        detail: `POST /api/public/v1/auth/handoff/redeem (audience: ${expected ?? 'session'})`,
        req,
      });
      const status = result.reason === 'audience_mismatch' ? 403 : 400;
      return apiError(status, result.reason, CODE_ERRORS[result.reason]);
    }

    const { claims } = result;

    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'login',
      targetType: 'auth',
      targetLabel: `${claims.sub} · handoff → ${result.audience}`,
      detail: `POST /api/public/v1/auth/handoff/redeem (${claims.role})`,
      req,
    });

    return NextResponse.json({
      valid: true,
      /**
       * Byte-for-byte the `user` of GET /api/auth/session, as asked: a consumer
       * maps one shape whichever way its user arrived. Note `role` is the
       * session role (`teacher` | `student`) — a DB `teacher-admin` shows up as
       * `users:*` in `permissions`, not as a third role.
       */
      user: {
        sub: claims.sub,
        role: claims.role,
        name: claims.name ?? null,
        code: claims.code ?? null,
        permissions: claims.permissions,
      },
      audience: result.audience,
      /** Same two clocks POST /api/auth/refresh reports (epoch ms). */
      expiresAt: sessionExpiresAt(claims),
      absoluteEndsAt: claims.login_at + absoluteTimeoutMs(),
    });
  } catch (err) {
    return handleError(err);
  }
}

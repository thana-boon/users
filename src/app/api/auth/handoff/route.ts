import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { SSO_COOKIE, verifySession } from '@/lib/jwt';
import { corsPreflight, withCors, isAllowedOrigin } from '@/lib/cors';
import { issueHandoffCode, isValidAudience } from '@/lib/handoff';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * GET /api/auth/handoff?audience=<consumer> — "give this browser something it
 * can prove its session with, on a server it trusts."
 *
 * The companion to GET /api/auth/session, for consumers that decide access in
 * middleware or a server component (Arena) rather than in the browser. The probe
 * answers to the page; this answers with a one-time code the page posts to its
 * OWN server, which redeems it at POST /api/public/v1/auth/handoff/redeem with
 * its API key. See lib/handoff.ts for why the code is safe to hand to JS.
 *
 * 200 either way, like the probe: "nobody is signed in" is a fact, not an error.
 *
 * Deliberately does NOT slide the idle window — like the probe, and for the same
 * reason (a consumer bootstrapping its own session every page load would keep a
 * walked-away session alive forever). Real activity is renewed through
 * POST /api/auth/refresh.
 *
 * Not audited: a code that is never redeemed says nothing worth keeping. The
 * redeem route writes the row, where there is an actual consumer to name.
 */

/** Per-session budget. Generous enough for tab-restore bursts, not for mining codes. */
const ISSUE_LIMIT = 10;
const ISSUE_WINDOW_MS = 60_000;

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { valid: false, code: null, error: { code, message } },
    { status },
  );
}

async function handler(req: NextRequest) {
  // Belt and braces. CORS already stops a browser on an unlisted origin from
  // READING the code, but refusing to mint it is the stronger statement — and
  // the one that still holds if a caller ignores the response headers. A
  // same-origin fetch sends no Origin header at all and is fine.
  const origin = req.headers.get('origin');
  if (origin && !isAllowedOrigin(origin)) {
    return fail(403, 'forbidden_origin', 'origin นี้ยังไม่ได้รับอนุญาตให้ใช้ SSO');
  }

  const audience = req.nextUrl.searchParams.get('audience');
  if (!isValidAudience(audience)) {
    return fail(400, 'invalid_audience', 'ต้องระบุ ?audience= ของระบบปลายทาง');
  }

  // Same order as /api/auth/session: the published cross-service cookie first,
  // then this app's own cookie or a Bearer token.
  const session =
    (await verifySession(req.cookies.get(SSO_COOKIE)?.value)) ??
    (await getSessionFromRequest(req));

  if (!session) return NextResponse.json({ valid: false, code: null });

  // Keyed by the session, not the IP: one shared-NAT school building is one IP,
  // and it is a single user's session that could be milked for codes.
  const gate = rateLimit(`handoff:${session.sub}`, ISSUE_LIMIT, ISSUE_WINDOW_MS);
  if (!gate.allowed) {
    const res = fail(429, 'rate_limited', 'ขอโค้ดถี่เกินไป ลองใหม่อีกครั้งภายหลัง');
    res.headers.set('Retry-After', String(gate.retryAfterSec));
    return res;
  }

  const { code, expiresIn } = issueHandoffCode(session, audience);
  return NextResponse.json({ valid: true, code, expiresIn, audience });
}

export const GET = withCors(handler);
export const OPTIONS = corsPreflight;

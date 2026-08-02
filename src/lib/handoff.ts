import { createHash, randomBytes } from 'node:crypto';
import { sessionExpiresAt, type SessionClaims } from './jwt';

/**
 * One-time handoff codes — turning "this browser has a SchoolOS session" into
 * something a server-rendered consumer can act on.
 *
 * A consumer whose pages are decided in middleware / server components (Arena)
 * cannot use `GET /api/auth/session`: that answer arrives in the user's browser,
 * on the wrong side of the wire, and `sso_session` is httpOnly so the page
 * cannot forward it either. So the browser asks us for a code instead, hands it
 * to its own server, and that server redeems it over the back channel with its
 * API key (`auth:handoff`).
 *
 * The code is deliberately the weakest credential we issue — 60 seconds, one
 * use, useless without the consumer's key — because unlike the cookie it does
 * travel through JavaScript. It grants nothing beyond what `/api/auth/session`
 * already tells that same browser; it just says it to a server that can trust it.
 *
 * Deliberately NOT a token: nothing is signed, so a code carries no meaning
 * outside this process's memory and cannot be replayed after we forget it.
 *
 * ## Why memory, not a table
 *
 * Same trade-off as lib/rate-limit.ts, and the same limit: this is per-process
 * state, so a multi-instance deployment would mint on one node and fail to
 * redeem on another. That is not a new constraint — login lockout and the API
 * rate limiter already live here and would break at the same moment — and it
 * buys the thing a table would have to work for: `consume()` is atomic, because
 * a Map delete in a single-threaded runtime cannot interleave. A 60-second code
 * is also not worth surviving a restart; the browser simply asks for another.
 */

/** Human-visible prefix, so a code in a log is recognisable at a glance. */
const CODE_PREFIX = 'hc_';
const CODE_BYTES = 32;

/** How long a code may sit unredeemed. The contract published to consumers. */
export const HANDOFF_TTL_MS = 60_000;

interface Entry {
  /** Snapshot of the session as it stood when the code was minted. */
  claims: SessionClaims;
  /** The consumer this code was minted for — only that key may redeem it. */
  audience: string;
  expiresAt: number;
}

/**
 * Keyed by SHA-256 of the code, never the code itself: the same reasoning as
 * api_keys.key_hash — a heap dump or an accidental log of this map holds
 * nothing that can be redeemed.
 */
const codes = new Map<string, Entry>();

/**
 * Codes that WERE redeemed, kept until they would have expired anyway. Costs a
 * hash per code and lets `used_code` be answered honestly instead of collapsing
 * into `invalid_code` — the difference between "your integration double-posted"
 * and "someone is guessing", which is exactly what an admin needs to see.
 */
const spent = new Map<string, number>();

function hash(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** Drop everything already past its deadline. Cheap: the map holds seconds of traffic. */
function sweep(now: number): void {
  for (const [k, v] of codes) if (v.expiresAt <= now) codes.delete(k);
  for (const [k, deadline] of spent) if (deadline <= now) spent.delete(k);
}

export interface IssuedCode {
  code: string;
  /** Seconds, as published to the consumer. */
  expiresIn: number;
}

/**
 * Mint a code for `audience` against the session that asked for it.
 *
 * The claims are snapshotted rather than re-read at redeem time because the
 * cookie is not present on the back-channel call — the consumer's server has an
 * API key, not the user's browser. `consume()` re-checks that the snapshot has
 * not died in the meantime.
 */
export function issueHandoffCode(claims: SessionClaims, audience: string): IssuedCode {
  const now = Date.now();
  sweep(now);

  const code = CODE_PREFIX + randomBytes(CODE_BYTES).toString('base64url');
  codes.set(hash(code), { claims, audience, expiresAt: now + HANDOFF_TTL_MS });
  return { code, expiresIn: Math.floor(HANDOFF_TTL_MS / 1000) };
}

export type ConsumeResult =
  | { ok: true; claims: SessionClaims; audience: string }
  | { ok: false; reason: 'invalid_code' | 'expired_code' | 'used_code' | 'audience_mismatch' };

/**
 * Spend a code. Whatever the outcome, the code is gone afterwards — including
 * on an audience mismatch, so a wrong guess costs the attacker the code rather
 * than letting them try it against every audience in turn.
 *
 * `expectedAudience` is the audience the CALLER is entitled to (from its API
 * key), not one it may name for itself.
 */
export function consumeHandoffCode(code: string, expectedAudience: string | null): ConsumeResult {
  const now = Date.now();
  const key = hash(code);

  const entry = codes.get(key);
  if (!entry) {
    // Order matters: a spent code is a more specific answer than "never existed".
    if ((spent.get(key) ?? 0) > now) return { ok: false, reason: 'used_code' };
    return { ok: false, reason: 'invalid_code' };
  }

  codes.delete(key);
  spent.set(key, entry.expiresAt);

  if (entry.expiresAt <= now) return { ok: false, reason: 'expired_code' };
  // null = the caller is an admin session checking the endpoint by hand, which
  // may redeem for any audience; an API key must match the code exactly.
  if (expectedAudience !== null && expectedAudience !== entry.audience) {
    return { ok: false, reason: 'audience_mismatch' };
  }
  // The session itself may have run out inside the 60-second window (it was
  // already near its idle deadline, or hit the 8h cap). A dead session must not
  // be resurrected by a code minted while it lived.
  if (sessionExpiresAt(entry.claims) <= now) return { ok: false, reason: 'expired_code' };

  return { ok: true, claims: entry.claims, audience: entry.audience };
}

/**
 * Audience names are compared against key config with ===, so what counts as a
 * name is defined once, in the module the key form validates against too.
 */
export { isValidAudience } from './api-scopes';

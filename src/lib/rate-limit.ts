/**
 * Tiny in-memory fixed-window rate limiter + login lockout.
 * Good enough for a single-instance dev/local deploy. For multi-instance prod,
 * back this with Redis. Keys are salted by purpose so login and API don't share.
 */

interface Bucket {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

const store = new Map<string, Bucket>();

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Fixed-window limiter. CONSUMES one unit — checkBudget() is the read-only half. */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateResult {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now > b.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
    };
  }
  b.count += 1;
  return { allowed: true, remaining: limit - b.count, retryAfterSec: 0 };
}

/**
 * Read a fixed-window bucket WITHOUT consuming from it.
 *
 * The pairing this exists for: a gate checked on the way IN and charged for on
 * the way OUT, only when the request turned out to be a failure.
 *
 * WHY that split matters. A per-IP budget that every request pays for is
 * unusable behind NAT, and the school's LAN is behind NAT — a whole building
 * reaches us as one address, so a class signing in at the start of a period is
 * indistinguishable from an attack and spends everyone's quota. That is not
 * hypothetical: it is what made logins fail intermittently on the internal
 * network while people on mobile data, each with an address of their own, never
 * saw a thing. Charging only failures keeps the defence intact — a password
 * sprayer produces nothing BUT failures — and stops billing the people who
 * typed their password correctly.
 */
export function checkBudget(key: string, limit: number): RateResult {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now > b.resetAt) {
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
    };
  }
  return { allowed: true, remaining: limit - b.count, retryAfterSec: 0 };
}

/**
 * Login lockout: after `maxFails` failures, lock the KEY for `lockMs`.
 * Call registerFailure() on bad password, clearFailures() on success.
 *
 * Callers do not use these three directly — loginLockout() below composes them
 * into the pair of buckets a login is actually judged by. See its comment for
 * why one bucket per account is the wrong shape.
 */
export function checkLockout(key: string): RateResult {
  const now = Date.now();
  const b = store.get(`lock:${key}`);
  if (b?.lockedUntil && now < b.lockedUntil) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000),
    };
  }
  return { allowed: true, remaining: 0, retryAfterSec: 0 };
}

/**
 * Returns true when THIS failure is the one that locked the identifier, so the
 * caller can write a single audit row for the event rather than one per
 * rejected attempt afterwards.
 */
export function registerFailure(
  key: string,
  maxFails = 5,
  windowMs = 15 * 60_000,
  lockMs = 15 * 60_000,
): boolean {
  const k = `lock:${key}`;
  const now = Date.now();
  const b = store.get(k);
  // A window that has run out — or one whose lock has already been served —
  // starts over. Without the second half a bucket whose lock is SHORTER than
  // its window comes back still holding maxFails failures, so the first typo
  // after the lock lifts re-locks it instantly.
  if (!b || now > b.resetAt || (b.lockedUntil && now >= b.lockedUntil)) {
    store.set(k, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count += 1;
  if (b.count < maxFails) return false;
  const wasLocked = !!(b.lockedUntil && now < b.lockedUntil);
  b.lockedUntil = now + lockMs;
  return !wasLocked;
}

export function clearFailures(key: string): void {
  store.delete(`lock:${key}`);
}

/**
 * The login gates' thresholds, read live from the environment (both login
 * routes declare `runtime = 'nodejs'`, so process.env is not build-inlined).
 *
 * Tunable because the right number depends on how the school's network is
 * shaped — one NAT address for the whole site wants a far larger per-IP budget
 * than one address per device — and that is not something to redeploy an image
 * over. Defaults suit a site behind a single address.
 */
export interface LoginLimits {
  /** Wrong-password attempts against REAL accounts, per IP per window. */
  ipFailLimit: number;
  /** Attempts against an identifier that matches nothing, per IP per window. */
  ipMissLimit: number;
  ipFailWindowMs: number;
  /** Failed attempts against ONE account FROM ONE ADDRESS before that address
   * is locked out of it. */
  lockMaxFails: number;
  /** Failed attempts against one account from ALL addresses together before the
   * account itself is locked. The backstop; see loginLockout(). */
  lockGlobalMaxFails: number;
  lockWindowMs: number;
  lockMs: number;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loginLimits(): LoginLimits {
  return {
    ipFailLimit: envInt('LOGIN_IP_FAIL_LIMIT', 50),
    ipMissLimit: envInt('LOGIN_IP_MISS_LIMIT', 300),
    ipFailWindowMs: envInt('LOGIN_IP_FAIL_WINDOW_MINUTES', 5) * 60_000,
    lockMaxFails: envInt('LOGIN_LOCKOUT_MAX_FAILS', 5),
    lockGlobalMaxFails: envInt('LOGIN_LOCKOUT_GLOBAL_MAX_FAILS', 30),
    lockWindowMs: envInt('LOGIN_LOCKOUT_WINDOW_MINUTES', 15) * 60_000,
    lockMs: envInt('LOGIN_LOCKOUT_MINUTES', 15) * 60_000,
  };
}

/**
 * The per-IP half of the login gates: check it on the way in, charge it on the
 * way out. Both login routes share one gate per address — a sprayer working
 * teachers and students from the same place is one attacker, not two.
 *
 * WHY TWO BUDGETS. A failure against an account that EXISTS is a credential
 * guess, which is the thing worth throttling hard. A failure against an
 * identifier that matches nothing is not: the login reply is deliberately
 * uniform, so such an attempt learns nothing at all, and the school's own
 * portal manufactures one on every single student sign-in — it tries
 * teacher-login first and falls back to student-login, so a student code always
 * misses the teacher table on the way past. Charging both to one budget would
 * put us straight back where we started, with normal morning traffic spending a
 * NATted site's quota. So misses get a separate, far higher ceiling that exists
 * only to stop a flood, and the strict budget is left for real guesses.
 */
export function loginIpGate(ip: string, limits: LoginLimits) {
  const failKey = `login-fail-ip:${ip}`;
  const missKey = `login-miss-ip:${ip}`;
  return {
    /** Read-only — does NOT consume. Reports whichever budget is spent. */
    check(): RateResult {
      const fail = checkBudget(failKey, limits.ipFailLimit);
      return fail.allowed ? checkBudget(missKey, limits.ipMissLimit) : fail;
    },
    /**
     * Charge one failed attempt. `known` = the identifier matched an account.
     * Returns true when this attempt is the one that spent the budget, so the
     * caller can note it on the audit row instead of on every later rejection.
     */
    charge(known: boolean): boolean {
      const r = known
        ? rateLimit(failKey, limits.ipFailLimit, limits.ipFailWindowMs)
        : rateLimit(missKey, limits.ipMissLimit, limits.ipFailWindowMs);
      return r.remaining === 0;
    },
  };
}

/** Which bucket is holding the door shut. */
export type LockScope = 'device' | 'account';

export interface LockoutResult extends RateResult {
  scope: LockScope | null;
}

/**
 * The per-account half of the login gates, as TWO buckets.
 *
 * WHY NOT ONE. A lockout keyed on the account alone locks it everywhere, so
 * anyone who knows a code — and codes are printed on ID cards, read out in
 * class, and sequential besides — can lock its owner out of the platform from
 * their own phone, five wrong guesses at a time, for as long as they care to
 * keep it up. The owner sitting at their own device, typing their own correct
 * password, is turned away by a stranger's failures. That is a denial of
 * service anybody can perform against anybody, and it costs the attacker
 * nothing.
 *
 * So the strict count — five — is kept per (account, address). It still stops
 * the thing a lockout is for, someone sitting at one machine working through
 * guesses, and now it stops them and only them: the victim's own device has its
 * own count, untouched. And a distributed attempt has not become free, because
 * two other gates already bound it — every address may spend only
 * LOGIN_IP_FAIL_LIMIT failures against real accounts per window, so an attacker
 * needs a fresh address for roughly every five guesses.
 *
 * The second bucket is the backstop for exactly that case: a much larger count
 * of failures against one account from every address at once, which no
 * legitimate person produces and a botnet does. It locks the account outright,
 * as the old single bucket did — just at a threshold a classmate with one phone
 * cannot reach.
 *
 * `ip` may be null when the request arrives without a forwarded address; those
 * all share one 'unknown' device bucket, which is the safe direction to fail
 * (stricter, not looser).
 */
export function loginLockout(
  audience: string,
  identifier: string,
  ip: string | null,
  limits: LoginLimits,
) {
  const account = `${audience}:${identifier.toLowerCase()}`;
  const deviceKey = `${account}@${ip ?? 'unknown'}`;
  return {
    /** Read-only. Reports the device lock first — it is the one a real person
     * hits, and its message can say so. */
    check(): LockoutResult {
      const device = checkLockout(deviceKey);
      if (!device.allowed) return { ...device, scope: 'device' };
      const acct = checkLockout(account);
      return { ...acct, scope: acct.allowed ? null : 'account' };
    },
    /**
     * Charge one failed attempt to both buckets. Returns which lock THIS
     * attempt tripped, so the caller can write a single audit row for the event
     * rather than one per rejection afterwards, or null if it tripped neither.
     */
    charge(): LockScope | null {
      const device = registerFailure(
        deviceKey,
        limits.lockMaxFails,
        limits.lockWindowMs,
        limits.lockMs,
      );
      const acct = registerFailure(
        account,
        limits.lockGlobalMaxFails,
        limits.lockWindowMs,
        limits.lockMs,
      );
      // The account-wide lock is the bigger event, so it wins the report.
      return acct ? 'account' : device ? 'device' : null;
    },
    /** A correct password clears both — the owner is demonstrably present. */
    clear(): void {
      clearFailures(deviceKey);
      clearFailures(account);
    },
  };
}

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
 * Login lockout: after `maxFails` failures, lock the identifier for `lockMs`.
 * Call registerFailure() on bad password, clearFailures() on success.
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
  if (!b || now > b.resetAt) {
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
  /** Failed attempts against ONE account before it is locked. */
  lockMaxFails: number;
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

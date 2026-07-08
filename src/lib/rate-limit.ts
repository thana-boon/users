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

/** Fixed-window limiter. */
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

export function registerFailure(
  key: string,
  maxFails = 5,
  windowMs = 15 * 60_000,
  lockMs = 15 * 60_000,
): void {
  const k = `lock:${key}`;
  const now = Date.now();
  const b = store.get(k);
  if (!b || now > b.resetAt) {
    store.set(k, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count >= maxFails) b.lockedUntil = now + lockMs;
}

export function clearFailures(key: string): void {
  store.delete(`lock:${key}`);
}

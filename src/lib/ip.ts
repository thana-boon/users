import type { NextRequest } from 'next/server';

/**
 * Resolve the real client IP behind our reverse proxy / gateway.
 *
 * WHY this is not just `xff.split(',')[0]`: `X-Forwarded-For` is a client-
 * supplied header. A caller can send `X-Forwarded-For: 1.2.3.4` and, since our
 * gateway *appends* the real peer, the header becomes `1.2.3.4, <realClient>`.
 * Taking the LEFTMOST entry therefore trusts an attacker-controlled value —
 * poisoning audit logs and any per-IP rate limiting.
 *
 * Correct model (same as express `trust proxy` = N): count `TRUSTED_PROXY_COUNT`
 * hops in from the RIGHT. With one gateway in front (the default) that is the
 * right-most entry, which the gateway itself set and the client cannot forge.
 * Set TRUSTED_PROXY_COUNT to the number of proxies actually in the chain; set 0
 * to ignore XFF entirely (direct-exposed app).
 */
function trustedProxyCount(): number {
  const n = Number(process.env.TRUSTED_PROXY_COUNT ?? '1');
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

export function clientIp(req?: Pick<NextRequest, 'headers'> | null): string | null {
  if (!req) return null;
  const hops = trustedProxyCount();

  if (hops > 0) {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) {
      const list = xff
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0) {
        // The entry `hops` from the right is the address as seen by the outer-
        // most proxy we trust; clamp so a short/forged list can't index before 0.
        const idx = Math.max(0, list.length - hops);
        return list[idx] ?? null;
      }
    }
  }

  // x-real-ip is set by the gateway (single value, overwritten each hop), so it
  // is a safe fallback when XFF is absent.
  return req.headers.get('x-real-ip') ?? null;
}

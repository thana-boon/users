/**
 * The SchoolOS front door — where a browser is sent once it has no business
 * being in this module any more: it signed out, or its session ran out.
 *
 * Users is the platform's identity provider, but it is not where anyone starts
 * their day. Dropping a signed-out teacher on this module's own login form
 * strands them inside one service; the portal is the page that can send them
 * anywhere, and after the SSO work one sign-in there covers every service.
 *
 * Deliberately imports nothing, so edge middleware, node route handlers and
 * Server Components can all ask the same question and get the same answer.
 *
 * PLATFORM_HOME_URL overrides it, with one caveat worth knowing: Next inlines
 * `process.env` at BUILD time for middleware (the same edge-runtime rule that
 * keeps the CORS allowlist out of middleware — see lib/cors.ts), so a value set
 * only in .env reaches the node routes and NOT middleware. The default below is
 * therefore the real production address rather than a placeholder, so that the
 * two agree without anyone having to rebuild.
 */
const DEFAULT_PLATFORM_HOME = 'https://schoolos.sukhon.ac.th/';

/**
 * Absolute URL of the portal, optionally carrying the same little flags this
 * module's own login page has always understood:
 *
 *   next=/users/students  where they were heading before the session ended
 *   expired=1             the idle timeout is why they are here
 *
 * They are a courtesy, not a contract — a portal that ignores them still lands
 * the user on a page they can use. `next` is filtered to a path inside the
 * platform: it arrives from the URL bar, and an absolute one would turn our own
 * redirect into somebody else's.
 */
export function platformHomeUrl(
  params?: Record<string, string | undefined>,
): string {
  const url = new URL(process.env.PLATFORM_HOME_URL?.trim() || DEFAULT_PLATFORM_HOME);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (!value) continue;
    if (key === 'next') {
      // Hand the portal the cleaned-up path, not the spelling it arrived in.
      const path = safeNextPath(value);
      if (!path) continue;
      url.searchParams.set(key, path);
      continue;
    }
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Origin that exists only to be compared against — see safeNextPath(). */
const NOWHERE = 'https://next.invalid';

/**
 * A `next=` value reduced to a path inside this app — query and fragment kept,
 * any authority refused — or null when it is not one.
 *
 * `startsWith('/')` is not the whole test. The URL parser folds `\` into `/` for
 * http(s), so `/\evil.com` is really `//evil.com`: an authority wearing a path's
 * clothes, and browsers read it the same way. Resolving against a throwaway
 * origin and insisting we landed back on it catches every spelling of that,
 * including the ones nobody has thought of yet.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/')) return null;
  let url: URL;
  try {
    url = new URL(raw, NOWHERE);
  } catch {
    return null;
  }
  if (url.origin !== NOWHERE) return null;
  return url.pathname + url.search + url.hash;
}

/**
 * The origin the BROWSER used, read off the request instead of a setting.
 *
 * Behind the gateway this app's own idea of where it lives is
 * `https://0.0.0.0:3002` — HOSTNAME/PORT from the Dockerfile, a bind address no
 * browser can dial, on a port only the gateway can reach. Anything built on it
 * lands the user on ERR_ADDRESS_INVALID, so redirects that must be absolute ask
 * the forwarded headers instead and fall back to `fallback` when running with no
 * proxy in front (dev on :3002, where the app's own origin IS the right one).
 *
 * The headers are attacker-controllable for anyone who can reach the container
 * directly, which is worth knowing but not worth defending here: the only thing
 * it buys is bouncing yourself to your own host. Nothing signed, mailed or
 * cached is built from this.
 */
export function publicOrigin(headers: Headers, fallback: string): string {
  // X-Forwarded-* may be a comma-separated chain; the first entry is the client.
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null;
  const host = first(headers.get('x-forwarded-host')) ?? first(headers.get('host'));
  if (!host) return fallback;
  try {
    // No X-Forwarded-Proto means nothing terminated TLS in front of us, so the
    // scheme we are already being served over is the honest one.
    const proto =
      first(headers.get('x-forwarded-proto')) ?? new URL(fallback).protocol.replace(':', '');
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return fallback;
  }
}

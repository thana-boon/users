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
    if (key === 'next' && (!value.startsWith('/') || value.startsWith('//'))) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

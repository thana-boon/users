import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { hasPermission } from '@/lib/jwt';
import { USERS_WRITE } from '@/lib/permissions';
import LoginForm from './LoginForm';

/**
 * Login screen for this module — SSO-aware.
 *
 * A Server Component so the "are you already signed in?" question is answered
 * from the cookie BEFORE anything renders: a user who signed in through another
 * SchoolOS service (Arena, Track, กีฬาสี — they all post to our login endpoints,
 * which set `sso_session`) is sent straight on, and never sees a second login
 * form or a flash of one.
 *
 * No probe over the network is involved: this app IS the identity provider, so
 * the session is a same-origin cookie it can verify itself. Nothing here can
 * hang or fail into a blank page — verifySession is fail-closed, and every path
 * that is not "signed in with users:write" ends at the form below.
 */

/**
 * Only ever redirect to a path inside this app. `next` reaches us from the query
 * string, so without this an emailed /users/login?next=https://evil.example link
 * would turn our own redirect into the attacker's.
 */
function safeNext(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/users';
  return value;
}

function flag(raw: string | string[] | undefined): boolean {
  return (Array.isArray(raw) ? raw[0] : raw) === '1';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const session = await getSession();

  // Already signed in AND allowed in — the whole point of the SSO check.
  if (hasPermission(session, USERS_WRITE)) redirect(next);

  // Signed in, but this account cannot enter the module. Deliberately NOT a
  // redirect: middleware would only bounce them right back here, and the two
  // would ping-pong. Show the form so they can sign in as an admin instead.
  const signedInAs = session ? (session.name ?? session.sub) : null;

  return (
    <LoginForm
      next={next}
      denied={flag(params.denied) || !!session}
      expired={flag(params.expired)}
      signedInAs={signedInAs}
    />
  );
}

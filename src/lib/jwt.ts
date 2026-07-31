import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * SchoolOS session token (local login only — no external SSO).
 *
 * On login (teacher-login / student-login) this app signs a JWT and drops it in
 * the `schoolos_token` cookie; middleware and routes only *verify* it. HS256
 * with the app's own `JWT_SECRET`. `jose` is used so the same verify runs in
 * edge middleware and node routes. Business logic only ever reads the claims
 * below.
 */

export type AppRole = 'teacher' | 'student';

export interface SessionClaims extends JWTPayload {
  sub: string; // username = teacher_code / student_code (e.g. "T00116")
  role: AppRole;
  name?: string;
  permissions: string[]; // e.g. ["users:read", "users:write"]
  login_at: number; // wall-clock of the ORIGINAL login (ms) — never slides
  code?: string; // optional label kept for local login (usually == sub)
}

/** Cookie this app's local login sets (httpOnly — the token itself). */
export const SESSION_COOKIE = 'schoolos_token';

/**
 * Companion cookie holding ONLY the moment this session dies (epoch ms), as a
 * plain number. Deliberately readable by JavaScript: components/SessionGuard
 * counts down against it to warn before the idle logout. It carries no
 * credential — the token stays httpOnly — and the server never trusts it.
 *
 * It must be readable WITHOUT asking the server, because any request to the
 * server would itself count as activity and so could never expire.
 */
export const SESSION_EXP_COOKIE = 'schoolos_session_exp';

/**
 * Idle window. The token's `exp` is set this far ahead and slides forward on
 * activity (middleware renews it, SessionGuard renews it while you type), so a
 * workstation left unattended logs itself out. Default 30 minutes.
 */
export function idleTimeoutMs(): number {
  const m = Number(process.env.SESSION_IDLE_MINUTES);
  return (Number.isFinite(m) && m > 0 ? m : 30) * 60_000;
}

/**
 * Hard cap measured from the ORIGINAL login. Never slides — no amount of
 * activity extends a session past it. Default 8 hours (one school day).
 */
export function absoluteTimeoutMs(): number {
  const h = Number(process.env.SESSION_ABSOLUTE_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 8) * 60 * 60_000;
}

/**
 * When this session actually ends: whichever comes first, the sliding idle
 * window or the absolute cap. This single number is what the countdown, the
 * cookie maxAge and the renewal decision all agree on.
 */
export function sessionExpiresAt(session: SessionClaims): number {
  const idleEnd = (session.exp ?? 0) * 1000;
  const absoluteEnd = session.login_at + absoluteTimeoutMs();
  return Math.min(idleEnd, absoluteEnd);
}

/** Permission that grants access to this (admin-only) Records module. */
export const USERS_READ = 'users:read';
export const USERS_WRITE = 'users:write';

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set.');
  return new TextEncoder().encode(s);
}

/**
 * `exp` for a token minted now: one idle window ahead, but never past the
 * absolute cap. Returned in SECONDS, the unit jose's setExpirationTime() takes
 * for a numeric argument.
 */
function expirationFor(loginAt: number): number {
  const end = Math.min(Date.now() + idleTimeoutMs(), loginAt + absoluteTimeoutMs());
  return Math.floor(end / 1000);
}

/**
 * Whether to set the `Secure` flag on the session cookie. Secure-by-default:
 * over HTTPS the session cookie is never sent in the clear. Explicitly opt OUT
 * (COOKIE_SECURE=false) ONLY for a plain-HTTP LAN/self-hosted deployment (e.g.
 * http://192.168.x.x) — a Secure cookie is silently dropped by the browser over
 * HTTP, which looks like "login succeeds but never redirects". Do not disable it
 * on any internet-facing/HTTPS deployment.
 */
export function cookieSecure(): boolean {
  return (process.env.COOKIE_SECURE ?? 'true').toLowerCase() !== 'false';
}

/** Shared cookie options for the session cookie (set on login, cleared on logout). */
export function sessionCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSecure(),
    path: '/',
    maxAge: maxAgeSec,
  };
}

/** Minimal cookie writer — the shape `NextResponse.cookies.set` accepts. */
type CookieJar = {
  set(name: string, value: string, options: ReturnType<typeof sessionCookieOptions>): unknown;
};

/**
 * Write both session cookies from one token, sized to the same deadline.
 *
 * Both get maxAge = time left, so an unattended browser drops them by itself
 * rather than keeping a dead token around to be replayed.
 */
export function setSessionCookies(jar: CookieJar, token: string, claims: SessionClaims): number {
  const expiresAt = sessionExpiresAt(claims);
  const maxAge = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
  jar.set(SESSION_EXP_COOKIE, String(expiresAt), {
    ...sessionCookieOptions(maxAge),
    httpOnly: false, // read by SessionGuard — see SESSION_EXP_COOKIE
  });
  return expiresAt;
}

/** Drop both cookies (logout, or a session the server has decided is over). */
export function clearSessionCookies(jar: CookieJar): void {
  const dead = { ...sessionCookieOptions(0), maxAge: 0 };
  jar.set(SESSION_COOKIE, '', dead);
  jar.set(SESSION_EXP_COOKIE, '', { ...dead, httpOnly: false });
}

/** A freshly signed session: the wire token plus the claims that are inside it. */
export interface MintedSession {
  token: string;
  claims: SessionClaims;
}

/**
 * Sign a token AND hand back the exact claims it carries.
 *
 * Everything that writes a cookie needs the `exp` that went into the token; the
 * claims are returned rather than decoded back out so the cookie deadline and
 * the JWT can never disagree (recomputing `expirationFor` a second time could
 * land one second later).
 */
async function mint(claims: SignInput): Promise<MintedSession> {
  const loginAt = claims.login_at ?? Date.now();
  const exp = expirationFor(loginAt);
  const token = await sign({ ...claims, login_at: loginAt }, exp);
  return { token, claims: { ...claims, login_at: loginAt, exp } as SessionClaims };
}

/**
 * Mint a brand-new session (login). Returns the token — the login routes still
 * put it in the response body — plus an `apply` that writes both cookies onto
 * whatever response the caller ends up building. Split that way because the
 * token has to exist before the response body can be constructed.
 */
export async function issueSession(
  claims: SignInput,
): Promise<{ token: string; apply: (jar: CookieJar) => number }> {
  const { token, claims: full } = await mint(claims);
  return { token, apply: (jar) => setSessionCookies(jar, token, full) };
}

/**
 * Slide the idle window forward, unconditionally — the explicit "อยู่ต่อ" /
 * still-typing path (POST /api/auth/refresh).
 *
 * `login_at` carries over, so this can push the deadline out to the absolute cap
 * and not one second past it: at the cap the new `exp` equals the old one.
 */
export function reissueSession(session: SessionClaims): Promise<MintedSession> {
  return mint({
    sub: session.sub,
    role: session.role,
    name: session.name,
    code: session.code,
    permissions: session.permissions,
    login_at: session.login_at, // never slides — that is the point
  });
}

/**
 * The same slide, but only when it is worth doing — the "activity = requests"
 * path in middleware. Returns null when the session is still fresh (so a page
 * load's burst of requests re-signs once, not once per request) or has already
 * been capped at the absolute deadline, where no activity can extend it.
 */
export async function renewSession(session: SessionClaims): Promise<MintedSession | null> {
  const absoluteEnd = session.login_at + absoluteTimeoutMs();
  const expiresAt = sessionExpiresAt(session);
  if (expiresAt >= absoluteEnd) return null; // already at the hard cap
  if (expiresAt - Date.now() > idleTimeoutMs() / 2) return null; // still fresh
  return reissueSession(session);
}

/** True if the session carries `perm`. Null-safe / fail-closed. */
export function hasPermission(
  session: SessionClaims | null,
  perm: string,
): boolean {
  return !!session && session.permissions.includes(perm);
}

/** The claims a caller supplies; `exp` and `iat` are the signer's business. */
export interface SignInput {
  sub: string;
  role: AppRole;
  name?: string;
  permissions: string[];
  code?: string;
  login_at?: number;
}

/** Sign with an already-decided `exp` (seconds). The one place jose is called. */
function sign(claims: SignInput & { login_at: number }, exp: number): Promise<string> {
  return new SignJWT({
    role: claims.role,
    name: claims.name,
    code: claims.code,
    permissions: claims.permissions,
    login_at: claims.login_at,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret());
}

/**
 * Mint a session token. Used by this app's local login (teacher-login /
 * student-login) — prefer issueSession(), which also writes the cookies.
 */
export async function signSession(claims: SignInput): Promise<string> {
  return (await mint(claims)).token;
}

/**
 * Verify a token. Returns claims on success, or null on any failure
 * (fail-closed): bad signature, expired `exp` (the idle window ran out),
 * unknown role, or a `login_at` past the absolute cap.
 *
 * Both timeouts are checked here, not just in the cookie's maxAge — a token
 * pasted back in by hand after the browser dropped it must still be refused.
 */
export async function verifySession(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
    });

    const role = payload.role;
    if (role !== 'teacher' && role !== 'student') return null;
    if (!payload.sub) return null;
    if (typeof payload.login_at !== 'number') return null;
    if (Date.now() - payload.login_at > absoluteTimeoutMs()) return null;

    return {
      ...payload,
      sub: payload.sub,
      role,
      permissions: Array.isArray(payload.permissions)
        ? (payload.permissions as string[])
        : [],
      login_at: payload.login_at,
    } as SessionClaims;
  } catch {
    return null;
  }
}

/**
 * API scope vocabulary — shared by the server guard and the manager UI.
 *
 * Kept in its own module (no `node:crypto` import, unlike src/lib/apikey.ts) so
 * client components can render scope pickers without dragging Node built-ins
 * into the browser bundle.
 *
 * The `:read` scopes return the roster (identity + ชั้น/ห้อง, no sensitive
 * fields). The `:pii` scopes are additive and gate decrypted เลขบัตร ปชช. —
 * useless alone, and every PII request is audited. Splitting them means the
 * common "มาดึงรายชื่อไป" integration never carries power to read citizen ids.
 *
 * The `:photo` scopes are additive in the same way and gate profile images. A
 * face is personal data and the payload is ~100x a roster row, so the common
 * "มาดึงรายชื่อไป" key does not carry it by default.
 *
 * The `auth:*` scopes gate credential verification (POST /auth/verify) and are
 * split per audience for the same reason: a system that only serves students
 * must not be able to test passwords against staff accounts.
 *
 * `auth:handoff` is the odd one out: it tests no password at all. It lets a
 * consumer's SERVER redeem a one-time code the user's browser already collected
 * from us, turning "this browser has a SchoolOS session" into something a
 * server-rendered app can act on. It is the strongest of the three — the code
 * arrives already authenticated — so a key carrying it must also name the
 * `handoff_audience` it is allowed to redeem for.
 */

export const API_SCOPES = [
  'students:read',
  'students:pii',
  'students:photo',
  'teachers:read',
  'teachers:pii',
  'teachers:photo',
  // คนงาน — a separate table from teachers (no login, no role), so it needs its
  // own scopes rather than riding on `teachers:read`. A key that pulls the
  // teaching staff has no business reading the support staff unless asked.
  'workers:read',
  'workers:pii',
  'workers:photo',
  // อาจารย์พิเศษ — its own table too. No `:pii` twin: the table holds no
  // เลขบัตร ปชช. and no password, so there is nothing to gate behind one. It
  // does hold a photo, and that gets the same additive scope as everyone else.
  'special-teachers:read',
  'special-teachers:photo',
  // School calendar: academic years + term windows. Read-only, no PII.
  // Added after the first keys were issued — existing keys keep working
  // unchanged, they just don't have this scope until an admin ticks it.
  'years:read',
  'auth:students',
  'auth:teachers',
  'auth:handoff',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Thai labels for the manager UI. */
export const SCOPE_LABEL_TH: Record<ApiScope, string> = {
  'students:read': 'อ่านรายชื่อนักเรียน',
  'students:pii': 'อ่านเลขบัตร ปชช. นักเรียน',
  'students:photo': 'ดึงรูปนักเรียน',
  'teachers:read': 'อ่านรายชื่อครู',
  'teachers:pii': 'อ่านเลขบัตร ปชช. ครู',
  'teachers:photo': 'ดึงรูปครู',
  'workers:read': 'อ่านรายชื่อคนงาน',
  'workers:pii': 'อ่านเลขบัตร ปชช. คนงาน',
  'workers:photo': 'ดึงรูปคนงาน',
  'special-teachers:read': 'อ่านรายชื่ออาจารย์พิเศษ',
  'special-teachers:photo': 'ดึงรูปอาจารย์พิเศษ',
  'years:read': 'อ่านปีการศึกษาและช่วงภาคเรียน',
  'auth:students': 'ตรวจรหัสผ่านนักเรียน (ล็อกอิน)',
  'auth:teachers': 'ตรวจรหัสผ่านครู (ล็อกอิน)',
  'auth:handoff': 'แลกโค้ดสานต่อ session (SSO handoff)',
};

/**
 * Scopes that expose personal data — flagged in the UI. Photos sit here too:
 * a face identifies a child as surely as a citizen id does.
 */
export const PII_SCOPES: ApiScope[] = [
  'students:pii',
  'teachers:pii',
  'workers:pii',
  'students:photo',
  'teachers:photo',
  'workers:photo',
  'special-teachers:photo',
];

/**
 * Scopes that let a key test passwords. Not PII (nothing secret is returned),
 * but sensitive enough to warrant their own flag in the manager UI.
 */
export const AUTH_SCOPES: ApiScope[] = ['auth:students', 'auth:teachers', 'auth:handoff'];

/** Scopes whose key must also name the system it acts for (`handoffAudience`). */
export const AUDIENCE_BOUND_SCOPES: ApiScope[] = ['auth:handoff'];

/**
 * Shape of an audience name — a service's short name, e.g. `arena`. Lives here
 * so the key form, the create/patch routes and the handoff endpoints all agree
 * on what is accepted; a name that round-trips differently anywhere would break
 * the exact-match compare that the whole binding rests on.
 */
export const AUDIENCE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidAudience(v: string | null | undefined): v is string {
  return !!v && AUDIENCE_PATTERN.test(v);
}

/** True if this set of scopes requires an audience to be set on the key. */
export function needsAudience(scopes: string[] | null | undefined): boolean {
  return (
    Array.isArray(scopes) &&
    AUDIENCE_BOUND_SCOPES.some((s) => scopes.includes(s))
  );
}

export function isApiScope(v: string): v is ApiScope {
  return (API_SCOPES as readonly string[]).includes(v);
}

/** True if `granted` satisfies `required`. Fail-closed on anything unexpected. */
export function hasScope(granted: string[] | null | undefined, required: ApiScope): boolean {
  return Array.isArray(granted) && granted.includes(required);
}

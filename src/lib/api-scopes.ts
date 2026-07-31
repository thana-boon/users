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
 */

export const API_SCOPES = [
  'students:read',
  'students:pii',
  'students:photo',
  'teachers:read',
  'teachers:pii',
  'teachers:photo',
  // School calendar: academic years + term windows. Read-only, no PII.
  // Added after the first keys were issued — existing keys keep working
  // unchanged, they just don't have this scope until an admin ticks it.
  'years:read',
  'auth:students',
  'auth:teachers',
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
  'years:read': 'อ่านปีการศึกษาและช่วงภาคเรียน',
  'auth:students': 'ตรวจรหัสผ่านนักเรียน (ล็อกอิน)',
  'auth:teachers': 'ตรวจรหัสผ่านครู (ล็อกอิน)',
};

/**
 * Scopes that expose personal data — flagged in the UI. Photos sit here too:
 * a face identifies a child as surely as a citizen id does.
 */
export const PII_SCOPES: ApiScope[] = [
  'students:pii',
  'teachers:pii',
  'students:photo',
  'teachers:photo',
];

/**
 * Scopes that let a key test passwords. Not PII (nothing secret is returned),
 * but sensitive enough to warrant their own flag in the manager UI.
 */
export const AUTH_SCOPES: ApiScope[] = ['auth:students', 'auth:teachers'];

export function isApiScope(v: string): v is ApiScope {
  return (API_SCOPES as readonly string[]).includes(v);
}

/** True if `granted` satisfies `required`. Fail-closed on anything unexpected. */
export function hasScope(granted: string[] | null | undefined, required: ApiScope): boolean {
  return Array.isArray(granted) && granted.includes(required);
}

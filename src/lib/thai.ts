/**
 * Thai date / string helpers. Source data uses Buddhist-era dates in
 * dd/mm/BBBB form (e.g. "28/05/2566"). We keep the raw string in the DB for
 * fidelity, but these helpers parse/format for display, age, and validation.
 */

const TH_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** Parse "dd/mm/BBBB" (Buddhist) into a JS Date (Gregorian). Returns null if bad. */
export function parseThaiDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y > 2400) y -= 543; // Buddhist -> Gregorian
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a raw Thai date string as "28 พ.ค. 2566" (keeps Buddhist year). */
export function formatThaiDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return String(raw);
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3];
  return `${d} ${TH_MONTHS[mo - 1] ?? ''} ${y}`.trim();
}

/** Compute age in years from a raw Thai birth date, relative to now. */
export function ageFromThaiDate(raw: string | null | undefined): number | null {
  const born = parseThaiDate(raw);
  if (!born) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const mDiff = now.getUTCMonth() - born.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < born.getUTCDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** Validate a Thai national ID (13 digits + checksum). Blank passes (optional). */
export function isValidCitizenId(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined || String(raw).trim() === '') return true;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

/** Trim + collapse whitespace; source data has lots of trailing spaces. */
export function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s === '' || s === '-' ? null : s;
}

/** Like clean but keeps "-" and returns '' instead of null (for non-null cols). */
export function cleanStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

export function toInt(v: unknown): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s.replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

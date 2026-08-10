/**
 * Thai date / string helpers. Source data uses Buddhist-era dates in
 * dd/mm/BBBB form (e.g. "28/05/2566"). We keep the raw string in the DB for
 * fidelity, but these helpers parse/format for display, age, and validation.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

const TH_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** Month names for the calendar header; the abbreviations are for display. */
export const TH_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** Sunday-first, as every Thai wall calendar prints it. */
export const TH_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/** Days in a Buddhist-era month (leap years included, ปี พ.ศ. = ค.ศ. + 543). */
export function daysInThaiMonth(month: number, yearBE: number): number {
  return new Date(Date.UTC(yearBE - 543, month, 0)).getUTCDate();
}

/** Weekday (0 = อาทิตย์) of the 1st of a Buddhist-era month. */
export function firstWeekdayOfThaiMonth(month: number, yearBE: number): number {
  return new Date(Date.UTC(yearBE - 543, month - 1, 1)).getUTCDay();
}

/**
 * Split "dd/mm/BBBB" into its parts, rejecting anything that is not a real day
 * on the calendar — 31/02/2569 parses as three numbers but is not a date, and
 * letting it through would silently roll over to 3 มี.ค. in the picker.
 */
export function thaiDateParts(raw: string | null | undefined): { day: number; month: number; yearBE: number } | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  // Source spreadsheets are พ.ศ., but a stray ค.ศ. year does turn up.
  const yearBE = Number(m[3]) > 2400 ? Number(m[3]) : Number(m[3]) + 543;
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > daysInThaiMonth(month, yearBE)) return null;
  return { day, month, yearBE };
}

/** Build the stored form "dd/mm/BBBB" from calendar numbers. */
export function toThaiDate(day: number, month: number, yearBE: number): string {
  return `${pad2(day)}/${pad2(month)}/${yearBE}`;
}

/**
 * Tidy what someone typed into the canonical "dd/mm/BBBB": accepts `-` `.` and
 * spaces as separators, a bare run of digits (31032569), a two-digit year (69 →
 * 2569) and a Gregorian year (2026 → 2569). Text we cannot read is handed back
 * untouched so the field can flag it instead of eating it.
 */
export function normalizeThaiInput(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  const sep = s.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/);
  const run = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  const m = sep ?? run;
  if (!m) return s;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const y = Number(m[3]);
  const yearBE = y < 100 ? 2500 + y : y > 2400 ? y : y + 543;
  if (month < 1 || month > 12 || day < 1 || day > daysInThaiMonth(month, yearBE)) return s;
  return toThaiDate(day, month, yearBE);
}

/** Parse "dd/mm/BBBB" (Buddhist) into a JS Date (Gregorian). Returns null if bad. */
export function parseThaiDate(raw: string | null | undefined): Date | null {
  const p = thaiDateParts(raw);
  if (!p) return null;
  return new Date(Date.UTC(p.yearBE - 543, p.month - 1, p.day));
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

/**
 * Raw Thai date -> "YYYY-MM-DD" (Gregorian), the form the SQL `date` columns
 * (ปีการศึกษา, วันหมดอายุ ของ API key) speak. Returns null when the text is not
 * a date — the caller must then keep showing the raw text rather than silently
 * blanking legacy data.
 */
export function thaiToIso(raw: string | null | undefined): string | null {
  const d = parseThaiDate(raw);
  if (!d) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * "YYYY-MM-DD" (Gregorian) -> raw Thai "dd/mm/BBBB".
 *
 * A `date` column filled in through the old native picker can hold a พ.ศ. year
 * outright ("2569-05-16") — the picker showed ค.ศ. and people typed the year
 * they meant. Nothing on this calendar happens in the year 2400 CE, so a year
 * past that is read as already-Buddhist instead of being shifted to 3112.
 */
export function isoToThai(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const y = Number(m[1]);
  return `${m[3]}/${m[2]}/${y > 2400 ? y : y + 543}`;
}

/** Today as a raw Thai date "dd/mm/BBBB", in the machine's local timezone. */
export function todayThai(): string {
  const now = new Date();
  return `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear() + 543}`;
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

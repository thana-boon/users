/**
 * Phone-number tidying — one rule, applied wherever a phone number is written.
 *
 * WHY this exists: the first student import came out of a spreadsheet whose
 * phone column was "เบอร์โทร-" style free text, and almost every row landed in
 * Postgres with a trailing "-" — `0812345678-`. Harmless to look at, poison to
 * use: another system dialling that string, or matching it against its own
 * copy, fails on a character nobody can see at the end of a table cell.
 *
 * The rule is deliberately conservative — TRIM the separators at the two ends
 * and nothing else:
 *
 *   '0812345678-'   → '0812345678'
 *   ' 02-123-4567 ' → '02-123-4567'   ← inner dashes are how people write it
 *   '-'             → null            ← a separator alone is not a number
 *   '081 234 5678'  → '081 234 5678'  ← spacing is the owner's business
 *
 * Digits are never added, removed or reordered. A number stored wrong stays
 * wrong and stays visible; this only removes the punctuation the import left
 * dangling. Reformatting to a canonical 0XX-XXX-XXXX would silently rewrite
 * เบอร์บ้าน, เบอร์ต่างประเทศ and "081xxxxxxx / 089xxxxxxx" alike, and a records
 * module has no business guessing at those.
 */

import { z } from 'zod';

/** Separators people put around a Thai phone number. */
const EDGE_SEPARATORS = /^[\s\-.,;:/|]+|[\s\-.,;:/|]+$/g;

/**
 * Trim the separators off both ends. Returns null for anything that holds no
 * digit at all, so '-' and '' both mean "no number on file" rather than a
 * string that looks like data.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.replace(EDGE_SEPARATORS, '');
  if (!trimmed || !/\d/.test(trimmed)) return null;
  return trimmed;
}

/** True if `normalizePhone` would change this value — used by the cleanup script's dry run. */
export function needsPhoneFix(value: string | null | undefined): boolean {
  if (value == null) return false;
  return normalizePhone(value) !== value;
}

/**
 * Apply {@link normalizePhone} to the phone-ish keys of a patch object,
 * leaving every other key untouched. Keys absent from the object stay absent —
 * a partial patch must not grow fields it did not name.
 */
export function normalizePhoneFields<T extends Record<string, unknown>>(
  row: T,
  keys: readonly (keyof T)[],
): T {
  const out = { ...row };
  for (const k of keys) {
    if (!(k in out)) continue;
    const v = out[k];
    if (typeof v === 'string' || v === null) {
      out[k] = normalizePhone(v as string | null) as T[keyof T];
    }
  }
  return out;
}

/**
 * The zod field every route that accepts a phone number should use.
 *
 * Nullable and optional like the hand-written `z.string().nullable().optional()`
 * it replaces, with one addition: the value is normalized during parse, so a
 * route cannot forget. `undefined` stays `undefined` — on a PATCH that means
 * "leave this column alone", and turning it into null here would blank a number
 * the caller never mentioned.
 */
export const phoneField = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : normalizePhone(v)));

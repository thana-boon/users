/**
 * Phone-number tidying — one rule, applied wherever a phone number is written.
 *
 * THE RULE: a phone number is stored as DIGITS ONLY. Everything else in the
 * field is punctuation people typed for readability, or junk an import dragged
 * in, and neither survives the save.
 *
 *   '0812345678-'   → '0812345678'   ← the trailing dash the first import left
 *   '089-8850863'   → '0898850863'
 *   ' 02-123-4567 ' → '021234567'
 *   '081 234 5678'  → '0812345678'
 *   'ไม่มี'          → null
 *   '-'             → null           ← punctuation alone is not a number
 *
 * WHY digits only, rather than the gentler "trim the ends" rule this started
 * as. A phone number is not prose; it is an identifier that other systems
 * dial, match against their own copy, and send SMS to. Every extra character
 * is a way for two systems holding the SAME number to disagree about it —
 * `089-8850863` and `0898850863` are one number and two strings. Storing the
 * digits makes the comparison work and leaves formatting to whoever displays
 * it, which is where formatting belongs.
 *
 * WHAT THIS IS SAFE TO DO, and how we know. The worry with digits-only is a
 * cell holding TWO numbers — `0812345678 / 0898765432` would fuse into one
 * 20-digit non-number, silently. The school's data was surveyed across all
 * eight phone columns before this rule was adopted: no such cell exists, and
 * exactly one value carried an inner separator at all. If a future import
 * brings some in, they must be split BEFORE loading, not fixed here.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: guess. A 9-digit landline, an 11-digit
 * typo and a leading zero Excel ate are all left exactly as they are, minus
 * punctuation. Padding, truncating or "correcting" them would bury a data-entry
 * error under a value that looks right. {@link phoneLooksOdd} flags them for a
 * human instead.
 *
 * The one cost: a `+66` international prefix loses its `+`. No number in the
 * school's data has one, and a primary school dialling abroad from this field
 * is not a case worth keeping a hole open for.
 */

import { z } from 'zod';

/**
 * Keep the digits, drop everything else. Returns null when nothing is left, so
 * '-', 'ไม่มี' and '' all mean "no number on file" rather than a string that
 * looks like data to everything downstream.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = value.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

/**
 * Thai phone numbers that are not suspicious: 9 digits (เบอร์บ้าน, 02-xxx-xxxx
 * and 0xx-xxx-xxx) or 10 (มือถือ, 08x/09x/06x).
 *
 * Used for a WARNING, never to refuse a save. A number outside this range is
 * usually a real mistake — a leading zero Excel ate, a finger slip, or a
 * เลขบัตรประชาชน pasted into the wrong box — but the office may have a reason
 * for it, and a records module that rejected the value would just get a blank
 * field instead of a wrong one. Showing the doubt is more useful than winning
 * the argument.
 */
export function phoneLooksOdd(value: string | null | undefined): boolean {
  const digits = normalizePhone(value);
  if (!digits) return false;
  return digits.length !== 9 && digits.length !== 10;
}

/** What to say about an odd-looking number. Null when it looks fine. */
export function phoneWarning(value: string | null | undefined): string | null {
  const digits = normalizePhone(value);
  if (!digits || !phoneLooksOdd(digits)) return null;
  if (digits.length === 13) {
    return 'เลข 13 หลัก — ใช่เลขบัตรประชาชนที่ใส่ผิดช่องหรือเปล่า?';
  }
  return `มี ${digits.length} หลัก (ปกติเบอร์บ้าน 9 หลัก มือถือ 10 หลัก) — ตรวจอีกครั้ง`;
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

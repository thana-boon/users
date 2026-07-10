import type { KeyStage } from '@/db/schema';

/**
 * Grade progression + key-stage helpers for the Thai school system.
 *
 * The single source of truth for grade order (used by promotion, numbering
 * sort, and the meta filter dropdowns). Promotion = "the next grade in this
 * list". A key-stage boundary (อ.3→ป.1, ป.6→ม.1, ม.3→ม.4) is detected by the
 * key stage changing between two grades — that is when the document system may
 * issue a "จบช่วงชั้น" certificate, WITHOUT the student leaving the school.
 */
export const GRADE_ORDER = [
  'เตรียมอนุบาล', 'อ.1', 'อ.2', 'อ.3',
  'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6',
  'ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6',
] as const;

const KEY_STAGE_OF: Record<string, KeyStage> = {
  'เตรียมอนุบาล': 'kindergarten', 'อ.1': 'kindergarten', 'อ.2': 'kindergarten', 'อ.3': 'kindergarten',
  'ป.1': 'primary', 'ป.2': 'primary', 'ป.3': 'primary', 'ป.4': 'primary', 'ป.5': 'primary', 'ป.6': 'primary',
  'ม.1': 'lower_secondary', 'ม.2': 'lower_secondary', 'ม.3': 'lower_secondary',
  'ม.4': 'upper_secondary', 'ม.5': 'upper_secondary', 'ม.6': 'upper_secondary',
};

export const KEY_STAGE_LABEL_TH: Record<KeyStage, string> = {
  kindergarten: 'อนุบาล',
  primary: 'ประถมศึกษา',
  lower_secondary: 'มัธยมศึกษาตอนต้น',
  upper_secondary: 'มัธยมศึกษาตอนปลาย',
};

/** Position in GRADE_ORDER, or a large number so unknown grades sort last. */
export function gradeIndex(grade: string | null | undefined): number {
  if (!grade) return 999;
  const i = GRADE_ORDER.indexOf(grade as (typeof GRADE_ORDER)[number]);
  return i === -1 ? 999 : i;
}

/** Sort comparator for grade strings by their curriculum order. */
export function compareGrades(a: string | null | undefined, b: string | null | undefined): number {
  return gradeIndex(a) - gradeIndex(b);
}

export function keyStageOf(grade: string | null | undefined): KeyStage | null {
  if (!grade) return null;
  return KEY_STAGE_OF[grade] ?? null;
}

/** The grade a student moves to on promotion, or null if none (ม.6 = top). */
export function nextGrade(grade: string | null | undefined): string | null {
  const i = gradeIndex(grade);
  if (i >= 999 || i >= GRADE_ORDER.length - 1) return null;
  return GRADE_ORDER[i + 1];
}

/** True when moving from `from` to `to` crosses a ช่วงชั้น boundary. */
export function isKeyStageBoundary(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  const a = keyStageOf(from);
  const b = keyStageOf(to);
  return !!a && !!b && a !== b;
}

/** Sort grade values ascending by curriculum order (mutates a copy). */
export function sortGrades(grades: string[]): string[] {
  return [...grades].sort(compareGrades);
}

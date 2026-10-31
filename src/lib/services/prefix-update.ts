import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings, enrollments, students } from '@/db/schema';
import { thaiDateParts } from '@/lib/thai';
import { resolveActiveYearId } from '@/lib/services/students';

/**
 * ปรับคำนำหน้าชื่อ — เด็กชาย → นาย, เด็กหญิง → นางสาว once a student is old enough.
 *
 * "Old enough" = turned PREFIX_AGE on or before the cutoff day of THIS calendar
 * year. The cutoff is a day + month the school picks (default 15 พ.ค., the
 * start of the school year), stored in app_settings; an absent row is the
 * default, so nothing needs seeding.
 *
 * Only students still studying are touched, and only prefixes in PROMOTE — a
 * student already นาย/นางสาว, or with an unusual prefix, is left alone.
 */

export const PREFIX_CUTOFF_KEY = 'prefix_cutoff';
export const DEFAULT_CUTOFF = { day: 15, month: 5 };
export const PREFIX_AGE = 15;

export interface Cutoff { day: number; month: number }

/** Normalise "เด็กชาย" / "ด.ช." / "ดช" to one comparable key. */
const norm = (p: string) => p.replace(/[.\s]/g, '');

const PROMOTE: Record<string, string> = {
  เด็กชาย: 'นาย',
  ดช: 'นาย',
  เด็กหญิง: 'นางสาว',
  ดญ: 'นางสาว',
};

export function newPrefixFor(prefix: string | null): string | null {
  return prefix ? (PROMOTE[norm(prefix)] ?? null) : null;
}

/** A real day-in-month (29 ก.พ. allowed — the compare is by month/day). */
export function validCutoff(day: number, month: number): boolean {
  return (
    Number.isInteger(day) && Number.isInteger(month) &&
    month >= 1 && month <= 12 &&
    day >= 1 && day <= new Date(Date.UTC(2024, month, 0)).getUTCDate()
  );
}

export async function readCutoff(): Promise<Cutoff> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, PREFIX_CUTOFF_KEY) });
  const m = row?.value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m && validCutoff(Number(m[1]), Number(m[2]))) return { day: Number(m[1]), month: Number(m[2]) };
  return DEFAULT_CUTOFF;
}

export async function saveCutoff(c: Cutoff, actorLabel: string | null): Promise<void> {
  const value = `${c.day}/${c.month}`;
  await db
    .insert(appSettings)
    .values({ key: PREFIX_CUTOFF_KEY, value, updatedBy: actorLabel })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actorLabel } });
}

/** Has this birth date reached PREFIX_AGE by the cutoff of `year` (ค.ศ.)? */
export function oldEnough(birthDate: string | null, cutoff: Cutoff, year: number): boolean {
  const p = thaiDateParts(birthDate);
  if (!p) return false;
  const turns = p.yearBE - 543 + PREFIX_AGE;
  if (turns !== year) return turns < year;
  return p.month < cutoff.month || (p.month === cutoff.month && p.day <= cutoff.day);
}

export interface PrefixCandidate {
  id: number;
  studentCode: string;
  name: string;
  gradeLevel: string | null;
  classroom: string | null;
  birthDate: string;
  from: string;
  to: string;
}

/** Who would change right now, plus how many could not be judged. */
export async function findCandidates(cutoff: Cutoff) {
  const yearId = await resolveActiveYearId();
  const rows = await db
    .select({
      id: students.id,
      studentCode: students.studentCode,
      prefix: students.prefix,
      firstName: students.firstName,
      lastName: students.lastName,
      birthDate: students.birthDate,
      gradeLevel: enrollments.gradeLevel,
      classroom: enrollments.classroom,
    })
    .from(students)
    .leftJoin(
      enrollments,
      and(eq(enrollments.studentId, students.id), eq(enrollments.academicYearId, yearId)),
    )
    .where(and(eq(students.isArchived, false), eq(students.status, 'studying')));

  const year = new Date().getFullYear();
  const candidates: PrefixCandidate[] = [];
  let noBirthDate = 0;
  for (const r of rows) {
    const to = newPrefixFor(r.prefix);
    if (!to) continue;
    if (!thaiDateParts(r.birthDate)) {
      noBirthDate++;
      continue;
    }
    if (!oldEnough(r.birthDate, cutoff, year)) continue;
    candidates.push({
      id: r.id,
      studentCode: r.studentCode,
      name: `${r.firstName} ${r.lastName}`,
      gradeLevel: r.gradeLevel,
      classroom: r.classroom,
      birthDate: r.birthDate!,
      from: r.prefix!,
      to,
    });
  }
  candidates.sort(
    (a, b) =>
      (a.gradeLevel ?? '').localeCompare(b.gradeLevel ?? '', 'th', { numeric: true }) ||
      (a.classroom ?? '').localeCompare(b.classroom ?? '', 'th', { numeric: true }) ||
      a.studentCode.localeCompare(b.studentCode, 'th', { numeric: true }),
  );
  return { candidates, noBirthDate, year };
}

/** Write the new prefixes. Re-derives the list server-side; the client sends no ids. */
export async function applyPrefixUpdate(cutoff: Cutoff): Promise<number> {
  const { candidates } = await findCandidates(cutoff);
  for (const to of new Set(candidates.map((c) => c.to))) {
    const ids = candidates.filter((c) => c.to === to).map((c) => c.id);
    await db.update(students).set({ prefix: to }).where(inArray(students.id, ids));
  }
  return candidates.length;
}

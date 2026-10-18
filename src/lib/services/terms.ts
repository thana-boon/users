import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { academicYears } from '@/db/schema';

export const TERMS = [1, 2] as const;
export type Term = (typeof TERMS)[number];

/** The active year and its ภาคเรียนปัจจุบัน, or null when no year is active. */
export async function activeYearTerm(): Promise<{ academicYearId: number; term: number } | null> {
  const y = await db.query.academicYears.findFirst({
    where: eq(academicYears.isActive, true),
    columns: { id: true, activeTerm: true },
  });
  return y ? { academicYearId: y.id, term: y.activeTerm } : null;
}

/**
 * Columns stamped on a newly added student/teacher/worker: the year and term
 * it entered the system. Spread into the insert's `values`.
 */
export async function entryStamp(): Promise<{ entryAcademicYearId: number | null; entryTerm: number | null }> {
  const a = await activeYearTerm();
  return { entryAcademicYearId: a?.academicYearId ?? null, entryTerm: a?.term ?? null };
}

/**
 * The ภาคเรียน to record for an exit in `academicYearId`. An explicit `term`
 * wins; otherwise the active term — but only when the exit year is the active
 * year, since another year's "current term" means nothing.
 */
export async function resolveExitTerm(
  academicYearId: number | null | undefined,
  term?: number | null,
): Promise<number | null> {
  if (term != null) return term;
  if (academicYearId == null) return null;
  const a = await activeYearTerm();
  return a && a.academicYearId === academicYearId ? a.term : null;
}

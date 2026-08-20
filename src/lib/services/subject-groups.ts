import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { specialTeachers, subjectGroups, teachers } from '@/db/schema';
import { SUBJECT_GROUP_OPTIONS } from '@/lib/options';

/**
 * กลุ่มสาระ — the managed picker behind `teachers.subject_group` and
 * `special_teachers.subject_group`.
 *
 * The rule this whole module exists to keep: **the rosters are never rewritten
 * by the arrival of this table.** Both columns stay plain text holding the same
 * strings they held before, so /api/public/v1/teachers?subjectGroup=... keeps
 * answering exactly what it answered yesterday. What changes is only where the
 * UI gets its options from — a list instead of a keyboard.
 *
 * That guarantee rests on `ensureSubjectGroups()` below: every distinct value
 * already sitting in either roster is inserted into the table on boot, so the
 * dropdown always contains the value each existing row already holds and
 * re-saving a teacher cannot silently move them to a different group.
 */

/** Trim + collapse inner whitespace. The one normalisation a name ever gets. */
export function cleanGroupName(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Fold for comparison only — never for storage. Case and whitespace vary
 * between a spreadsheet cell and what someone typed into the picker, and
 * "กลุ่มสาระการเรียนรู้ ภาษาไทย" is the same group as "กลุ่มสาระการเรียนรู้ภาษาไทย".
 */
function foldName(v: string): string {
  return v.replace(/\s+/g, '').toLowerCase();
}

/**
 * Distinct กลุ่มสาระ actually in use, across BOTH rosters, archived included.
 *
 * Returned VERBATIM — not run through `cleanGroupName`. The picker matches a
 * record's stored value by exact string, so a name that came back tidied would
 * no longer equal what the roster holds and those people would show as
 * "(ค่าเดิม)" instead of simply being selected. Seeding has to mirror the data
 * as it is, even where the data is untidy; tidying is what the rename button is
 * for, and it moves everybody together.
 */
async function namesInUse(): Promise<string[]> {
  const [t, s] = await Promise.all([
    db
      .selectDistinct({ v: teachers.subjectGroup })
      .from(teachers)
      .where(isNotNull(teachers.subjectGroup)),
    db
      .selectDistinct({ v: specialTeachers.subjectGroup })
      .from(specialTeachers)
      .where(isNotNull(specialTeachers.subjectGroup)),
  ]);
  // Archived people are counted deliberately: restoring someone from ถังขยะ must
  // not land them in a group the picker has never heard of.
  return [...t, ...s].map((r) => r.v ?? '').filter((v) => v.trim() !== '');
}

let seeded = false;

/**
 * Make the table describe reality. Idempotent, safe to run on every boot.
 *
 * 1. Backfill every name already on a roster — this is the upgrade-safety step.
 * 2. Add the school's default list for anything still missing, so a fresh
 *    install (and a school that has not filled in a group yet) starts usable.
 *
 * Never deletes and never renames: a name it does not recognise is one the
 * school added on purpose, not a mistake to clean up.
 */
export async function ensureSubjectGroups(): Promise<void> {
  if (seeded) return; // one attempt per server process
  seeded = true;

  try {
    const existing = await db.select({ name: subjectGroups.name }).from(subjectGroups);
    const exact = new Set(existing.map((r) => r.name));
    const folded = new Set(existing.map((r) => foldName(r.name)));
    const toAdd: string[] = [];

    // Pass 1 — every name a roster actually holds, deduped by EXACT string. Not
    // by fold: if the data really does contain two spellings, both need a row,
    // or one set of people would be left without a matching option.
    for (const name of await namesInUse()) {
      if (exact.has(name)) continue;
      exact.add(name);
      folded.add(foldName(name));
      toAdd.push(name);
    }

    // Pass 2 — the school's default list, for a fresh install and for groups
    // nobody has been filed under yet. Skipped where a roster name already
    // means the same thing, so the spelling their 120 teachers carry wins over
    // the one written in the source code.
    for (const name of SUBJECT_GROUP_OPTIONS) {
      if (folded.has(foldName(name))) continue;
      folded.add(foldName(name));
      toAdd.push(name);
    }
    if (toAdd.length === 0) return;

    // sort_order continues after whatever is already there, so a re-run appends
    // rather than shuffling an order the school has arranged by hand.
    const [maxRow] = await db
      .select({ n: sql<number>`coalesce(max(${subjectGroups.sortOrder}), 0)::int` })
      .from(subjectGroups);
    let order = Number(maxRow?.n ?? 0);

    await db
      .insert(subjectGroups)
      .values(toAdd.map((name) => ({ name, sortOrder: (order += 10) })))
      .onConflictDoNothing({ target: subjectGroups.name });

    console.log(`[subject-groups] seeded ${toAdd.length} กลุ่มสาระ`);
  } catch (err) {
    // Same contract as the admin bootstrap: never take the server down over it.
    console.error('[subject-groups] seed skipped:', err);
  }
}

/** Active groups in display order — what every picker and importer reads. */
export async function listActiveNames(): Promise<string[]> {
  const rows = await db
    .select({ name: subjectGroups.name })
    .from(subjectGroups)
    .where(eq(subjectGroups.isActive, true))
    .orderBy(asc(subjectGroups.sortOrder), asc(subjectGroups.name));
  return rows.map((r) => r.name);
}

/**
 * Snap an imported cell onto the group it obviously means.
 *
 * Returns the canonical spelling on a fold-equal match, `null` for a blank
 * cell, and `undefined` when the value matches no group at all — which the
 * import routes turn into a per-row error rather than quietly creating a
 * twelfth group out of a typo. That is the whole reason the school asked for
 * this table.
 */
export function snapSubjectGroup(
  raw: string | null | undefined,
  known: readonly string[],
): string | null | undefined {
  const name = cleanGroupName(raw);
  if (!name) return null;
  const key = foldName(name);
  return known.find((k) => foldName(k) === key) ?? undefined;
}

/** How many live people carry this exact name, per roster. */
export async function countGroupUsage(name: string): Promise<{
  teachers: number;
  specialTeachers: number;
}> {
  const [t, s] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(teachers)
      .where(and(eq(teachers.isArchived, false), eq(teachers.subjectGroup, name))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(specialTeachers)
      .where(and(eq(specialTeachers.isArchived, false), eq(specialTeachers.subjectGroup, name))),
  ]);
  return { teachers: Number(t[0]?.n ?? 0), specialTeachers: Number(s[0]?.n ?? 0) };
}

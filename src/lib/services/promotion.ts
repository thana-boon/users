import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { enrollments, students, completions } from '@/db/schema';
import { isKeyStageBoundary, keyStageOf } from '@/lib/grades';

/**
 * Promotion + class-number assignment services.
 *
 * Promotion moves a set of students into their next-year enrollment. It does
 * NOT touch a student's lifecycle status: continuing at the same school across
 * a ช่วงชั้น boundary (ป.6→ม.1) is a normal promotion, optionally recorded as a
 * `completions` milestone so the future document API can issue the ปพ.
 * certificate — see src/lib/grades.ts and the schema notes on `completions`.
 */

export interface PromoteItem {
  studentId: number;
  fromGrade: string | null; // current-year grade (used to detect a stage boundary)
  targetGrade: string | null;
  targetClassroom: string | null;
}

export interface PromoteInput {
  sourceYearId: number;
  targetYearId: number;
  items: PromoteItem[];
  /** Record a "จบช่วงชั้น" milestone for students crossing a key-stage boundary. */
  recordCompletion: boolean;
  /** Assign fresh 1..N class numbers per target grade+room (ordered by code). */
  renumber: boolean;
}

export interface PromoteResult {
  promoted: number;
  completionsRecorded: number;
}

export async function promoteStudents(input: PromoteInput): Promise<PromoteResult> {
  const { sourceYearId, targetYearId, items, recordCompletion, renumber } = input;
  if (sourceYearId === targetYearId) {
    throw new Error('ปีต้นทางและปลายทางต้องต่างกัน');
  }
  if (!items.length) return { promoted: 0, completionsRecorded: 0 };

  return db.transaction(async (tx) => {
    let completionsRecorded = 0;

    for (const it of items) {
      // Upsert the target-year enrollment. classNumber is left untouched on
      // update (or null on insert) — the renumber pass below fills it in.
      await tx
        .insert(enrollments)
        .values({
          studentId: it.studentId,
          academicYearId: targetYearId,
          gradeLevel: it.targetGrade,
          classroom: it.targetClassroom,
          classNumber: null,
          seqOrder: null,
        })
        .onConflictDoUpdate({
          target: [enrollments.studentId, enrollments.academicYearId],
          set: { gradeLevel: it.targetGrade, classroom: it.targetClassroom },
        });

      if (recordCompletion && isKeyStageBoundary(it.fromGrade, it.targetGrade)) {
        const stage = keyStageOf(it.fromGrade);
        if (stage) {
          const res = await tx
            .insert(completions)
            .values({
              studentId: it.studentId,
              academicYearId: sourceYearId,
              keyStage: stage,
              gradeLevel: it.fromGrade,
            })
            .onConflictDoNothing({
              target: [completions.studentId, completions.keyStage],
            })
            .returning({ id: completions.id });
          completionsRecorded += res.length;
        }
      }
    }

    if (renumber) {
      // Distinct target grade+room groups touched by this batch. Re-sequence
      // each group 1..N ordered by student code (decision: renumber on promote).
      const groups = new Map<string, { grade: string | null; room: string | null }>();
      for (const it of items) {
        groups.set(`${it.targetGrade ?? ''}|${it.targetClassroom ?? ''}`, {
          grade: it.targetGrade,
          room: it.targetClassroom,
        });
      }
      for (const g of groups.values()) {
        const rows = await tx
          .select({ enrollmentId: enrollments.id })
          .from(enrollments)
          .innerJoin(students, eq(students.id, enrollments.studentId))
          .where(
            and(
              eq(enrollments.academicYearId, targetYearId),
              g.grade === null ? undefined : eq(enrollments.gradeLevel, g.grade),
              g.room === null ? undefined : eq(enrollments.classroom, g.room),
              eq(students.isArchived, false),
            ),
          )
          .orderBy(asc(students.studentCode));

        let n = 1;
        for (const r of rows) {
          await tx
            .update(enrollments)
            .set({ classNumber: String(n), seqOrder: n })
            .where(eq(enrollments.id, r.enrollmentId));
          n += 1;
        }
      }
    }

    return { promoted: items.length, completionsRecorded };
  });
}

export interface NumberAssignment {
  enrollmentId: number;
  classNumber: string | null;
  seqOrder: number | null;
}

/**
 * Persist explicit class numbers for a room. The UI computes the values
 * (sort by gender/code/name, keep-gaps vs sequential, or manual edits) and
 * sends the final list; the server just writes them in one transaction.
 */
export async function saveClassNumbers(assignments: NumberAssignment[]): Promise<number> {
  if (!assignments.length) return 0;
  await db.transaction(async (tx) => {
    for (const a of assignments) {
      await tx
        .update(enrollments)
        .set({ classNumber: a.classNumber, seqOrder: a.seqOrder })
        .where(eq(enrollments.id, a.enrollmentId));
    }
  });
  return assignments.length;
}

/** Guard: keep only enrollment ids that exist in the given year (defence). */
export async function enrollmentIdsInYear(ids: number[], yearId: number): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(inArray(enrollments.id, ids), eq(enrollments.academicYearId, yearId)));
  return new Set(rows.map((r) => r.id));
}

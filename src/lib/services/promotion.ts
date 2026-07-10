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

export interface TransferItem {
  enrollmentId: number;
  targetClassroom: string | null;
}

export interface TransferInput {
  yearId: number;
  /** Grade of the roster being edited — needed to scope the optional renumber. */
  grade: string | null;
  /** Re-sequence 1..N every room in (year, grade) after the moves. */
  renumber: boolean;
  items: TransferItem[];
}

/**
 * Move students between rooms **within the same academic year** — the single-
 * student / small-batch "ย้ายห้อง" case that promotion (which creates a NEW
 * next-year enrollment) doesn't cover. Updates the existing enrollment's room
 * in place; grade + year are untouched. Only the students whose room actually
 * changed are passed in. Optionally renumbers all rooms of the grade so numbers
 * stay 1..N after a move (off by default — a lone move usually keeps numbers).
 */
export async function transferRooms(input: TransferInput): Promise<{ moved: number }> {
  const { yearId, grade, renumber, items } = input;
  if (!items.length) return { moved: 0 };

  return db.transaction(async (tx) => {
    for (const it of items) {
      // Scope to yearId as a defence so a stale enrollmentId can't touch another year.
      await tx
        .update(enrollments)
        .set({ classroom: it.targetClassroom })
        .where(and(eq(enrollments.id, it.enrollmentId), eq(enrollments.academicYearId, yearId)));
    }

    if (renumber && grade) {
      // Re-sequence every room in this grade (covers both the rooms that lost and
      // gained a student). Ordered by room then code so per-room counters run 1..N.
      const rows = await tx
        .select({ enrollmentId: enrollments.id, classroom: enrollments.classroom })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(
          and(
            eq(enrollments.academicYearId, yearId),
            eq(enrollments.gradeLevel, grade),
            eq(students.isArchived, false),
          ),
        )
        .orderBy(asc(enrollments.classroom), asc(students.studentCode));

      const counters = new Map<string, number>();
      for (const r of rows) {
        const key = r.classroom ?? '';
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        await tx
          .update(enrollments)
          .set({ classNumber: String(n), seqOrder: n })
          .where(eq(enrollments.id, r.enrollmentId));
      }
    }

    return { moved: items.length };
  });
}

export interface PlaceItem {
  /** Existing student to enroll. Mutually exclusive with `newStudent`. */
  studentId?: number | null;
  /** A brand-new student to create (quick-add), then enroll. */
  newStudent?: {
    studentCode: string;
    prefix?: string | null;
    firstName: string;
    lastName: string;
    gender?: string | null;
  } | null;
  targetClassroom: string | null;
}

export interface PlaceInput {
  yearId: number;
  /** Target grade every placed student lands in. */
  grade: string | null;
  /** Re-sequence 1..N every room of (year, grade) after placing. */
  renumber: boolean;
  items: PlaceItem[];
}

export interface PlaceResult {
  placed: number;
  /** How many of the placed students were newly created (quick-add). */
  created: number;
}

/**
 * Place students into a (year, grade, room) — the "จัดนักเรียนเข้าห้อง" case:
 * building a grade's roster from students who don't yet have an enrollment that
 * year. Two sources per item: an EXISTING student (`studentId`, e.g. a re-entry
 * / mid-year transfer-in) or a NEW student to create on the spot (`newStudent`,
 * a quick-add stand-in until the admission/รับสมัคร system feeds this pool).
 * Enrollment is upserted on (student, year) so re-running is idempotent; grade +
 * room are (re)written. Optionally renumbers every room of the grade afterward.
 */
export async function placeStudents(input: PlaceInput): Promise<PlaceResult> {
  const { yearId, grade, renumber, items } = input;
  if (!items.length) return { placed: 0, created: 0 };

  return db.transaction(async (tx) => {
    let created = 0;

    for (const it of items) {
      let studentId = it.studentId ?? null;

      // Quick-add: mint a minimal student record (name + code only; the rest is
      // filled later via the registry edit form). status/role take their defaults.
      if (!studentId && it.newStudent) {
        const ns = it.newStudent;
        const [row] = await tx
          .insert(students)
          .values({
            studentCode: ns.studentCode,
            prefix: ns.prefix ?? null,
            firstName: ns.firstName,
            lastName: ns.lastName,
            gender: ns.gender ?? null,
            status: 'studying',
          })
          .returning({ id: students.id });
        studentId = row.id;
        created += 1;
      }

      if (!studentId) continue;

      await tx
        .insert(enrollments)
        .values({
          studentId,
          academicYearId: yearId,
          gradeLevel: grade,
          classroom: it.targetClassroom,
          classNumber: null,
          seqOrder: null,
        })
        .onConflictDoUpdate({
          target: [enrollments.studentId, enrollments.academicYearId],
          set: { gradeLevel: grade, classroom: it.targetClassroom },
        });
    }

    if (renumber && grade) {
      // Re-sequence every room of the grade (same policy as transferRooms).
      const rows = await tx
        .select({ enrollmentId: enrollments.id, classroom: enrollments.classroom })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(
          and(
            eq(enrollments.academicYearId, yearId),
            eq(enrollments.gradeLevel, grade),
            eq(students.isArchived, false),
          ),
        )
        .orderBy(asc(enrollments.classroom), asc(students.studentCode));

      const counters = new Map<string, number>();
      for (const r of rows) {
        const key = r.classroom ?? '';
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        await tx
          .update(enrollments)
          .set({ classNumber: String(n), seqOrder: n })
          .where(eq(enrollments.id, r.enrollmentId));
      }
    }

    return { placed: items.length, created };
  });
}

export interface ImportPlaceRow {
  studentId: number;
  gradeLevel: string | null;
  classroom: string | null;
}

export interface ImportPlaceInput {
  yearId: number;
  /** Re-sequence 1..N each (grade, room) group touched, ordered by code. */
  renumber: boolean;
  rows: ImportPlaceRow[];
}

/**
 * Bulk CSV placement: upsert a (year, grade, room) enrollment for many existing
 * students at once — the "จัดห้องข้ามช่วงชั้นทีละหลายคน" case (e.g. ป.6/1 scattering
 * into ม.1/2, ม.1/3, ม.1/4). Unlike `placeStudents`, the grade is PER ROW so one
 * file can span several grades/rooms. Students must already exist (resolved from
 * studentCode by the route). Enrollment upserts on (student, year) so re-running
 * is idempotent. Optionally renumbers each touched grade+room group afterward.
 */
export async function importPlacements(input: ImportPlaceInput): Promise<{ placed: number }> {
  const { yearId, renumber, rows } = input;
  if (!rows.length) return { placed: 0 };

  return db.transaction(async (tx) => {
    for (const r of rows) {
      await tx
        .insert(enrollments)
        .values({
          studentId: r.studentId,
          academicYearId: yearId,
          gradeLevel: r.gradeLevel,
          classroom: r.classroom,
          classNumber: null,
          seqOrder: null,
        })
        .onConflictDoUpdate({
          target: [enrollments.studentId, enrollments.academicYearId],
          set: { gradeLevel: r.gradeLevel, classroom: r.classroom },
        });
    }

    if (renumber) {
      const groups = new Map<string, { grade: string | null; room: string | null }>();
      for (const r of rows) {
        groups.set(`${r.gradeLevel ?? ''}|${r.classroom ?? ''}`, { grade: r.gradeLevel, room: r.classroom });
      }
      for (const g of groups.values()) {
        const grp = await tx
          .select({ enrollmentId: enrollments.id })
          .from(enrollments)
          .innerJoin(students, eq(students.id, enrollments.studentId))
          .where(
            and(
              eq(enrollments.academicYearId, yearId),
              g.grade === null ? undefined : eq(enrollments.gradeLevel, g.grade),
              g.room === null ? undefined : eq(enrollments.classroom, g.room),
              eq(students.isArchived, false),
            ),
          )
          .orderBy(asc(students.studentCode));
        let n = 1;
        for (const row of grp) {
          await tx
            .update(enrollments)
            .set({ classNumber: String(n), seqOrder: n })
            .where(eq(enrollments.id, row.enrollmentId));
          n += 1;
        }
      }
    }

    return { placed: rows.length };
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

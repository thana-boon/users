import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments, academicYears, studentLeaves } from '@/db/schema';

/**
 * พักการเรียน — leave-of-absence episodes.
 *
 * A leave is NOT an exit (see the `student_leaves` note in schema.ts): the
 * student keeps `status = 'studying'`, keeps the enrollment row, and is
 * promoted at year end like anyone else. So nothing here touches
 * `students.status` — it only opens and closes episode rows.
 *
 * "on leave right now" = an episode with `returned_date IS NULL`. A student may
 * have at most one of those open at a time; `startLeave` refuses to open a
 * second so the badge can never be ambiguous.
 */

const norm = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

export interface LeaveRow {
  id: number;
  studentId: number;
  studentCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  gender: string | null;
  leaveType: string;
  startDate: string | null;
  expectedReturnDate: string | null;
  returnedDate: string | null;
  reason: string | null;
  orderNo: string | null;
  year: number | null; // academic year the leave started in
  gradeLevel: string | null; // grade in that year
  classroom: string | null;
}

const leaveSelect = {
  id: studentLeaves.id,
  studentId: students.id,
  studentCode: students.studentCode,
  prefix: students.prefix,
  firstName: students.firstName,
  lastName: students.lastName,
  gender: students.gender,
  leaveType: studentLeaves.leaveType,
  startDate: studentLeaves.startDate,
  expectedReturnDate: studentLeaves.expectedReturnDate,
  returnedDate: studentLeaves.returnedDate,
  reason: studentLeaves.reason,
  orderNo: studentLeaves.orderNo,
  year: academicYears.year,
  gradeLevel: enrollments.gradeLevel,
  classroom: enrollments.classroom,
};

/**
 * Every leave episode, newest first. `scope: 'open'` narrows to the students
 * currently away; 'all' also returns the ones who have already come back.
 */
export async function listLeaves(scope: 'open' | 'all' = 'all'): Promise<LeaveRow[]> {
  const conds = [eq(students.isArchived, false)];
  if (scope === 'open') conds.push(isNull(studentLeaves.returnedDate));

  return db
    .select(leaveSelect)
    .from(studentLeaves)
    .innerJoin(students, eq(students.id, studentLeaves.studentId))
    .leftJoin(academicYears, eq(academicYears.id, studentLeaves.academicYearId))
    // Grade/room as of the year the leave started, not today's.
    .leftJoin(
      enrollments,
      and(
        eq(enrollments.studentId, studentLeaves.studentId),
        eq(enrollments.academicYearId, studentLeaves.academicYearId),
      ),
    )
    .where(and(...conds))
    .orderBy(desc(studentLeaves.id));
}

/** Full leave history for one student, oldest first (for the detail page). */
export async function listLeavesForStudent(studentId: number): Promise<LeaveRow[]> {
  return db
    .select(leaveSelect)
    .from(studentLeaves)
    .innerJoin(students, eq(students.id, studentLeaves.studentId))
    .leftJoin(academicYears, eq(academicYears.id, studentLeaves.academicYearId))
    .leftJoin(
      enrollments,
      and(
        eq(enrollments.studentId, studentLeaves.studentId),
        eq(enrollments.academicYearId, studentLeaves.academicYearId),
      ),
    )
    .where(eq(studentLeaves.studentId, studentId))
    .orderBy(asc(studentLeaves.id));
}

/**
 * Which of these students are on leave right now — for the badge in list views.
 * Returns a map studentId → leaveType so the caller needs one query, not N.
 */
export async function openLeavesFor(studentIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(studentIds)].filter((n) => Number.isFinite(n));
  if (!ids.length) return new Map();
  const rows = await db
    .select({ studentId: studentLeaves.studentId, leaveType: studentLeaves.leaveType })
    .from(studentLeaves)
    .where(and(inArray(studentLeaves.studentId, ids), isNull(studentLeaves.returnedDate)));
  return new Map(rows.map((r) => [r.studentId, r.leaveType]));
}

export interface StartLeaveInput {
  studentIds: number[];
  academicYearId: number;
  leaveType: string;
  startDate: string;
  expectedReturnDate?: string | null;
  reason?: string | null;
  orderNo?: string | null;
  note?: string | null;
}

/**
 * Open a leave episode for a batch of students. Students who already have an
 * open episode are skipped (not duplicated) and reported back in `skipped`, so
 * the caller can say so rather than silently doing nothing.
 */
export async function startLeave(
  input: StartLeaveInput,
): Promise<{ created: number; skipped: number[] }> {
  const ids = [...new Set(input.studentIds)].filter((n) => Number.isFinite(n));
  if (!ids.length) return { created: 0, skipped: [] };

  return db.transaction(async (tx) => {
    const already = await tx
      .select({ studentId: studentLeaves.studentId })
      .from(studentLeaves)
      .where(and(inArray(studentLeaves.studentId, ids), isNull(studentLeaves.returnedDate)));
    const skip = new Set(already.map((r) => r.studentId));
    const todo = ids.filter((id) => !skip.has(id));
    if (!todo.length) return { created: 0, skipped: [...skip] };

    await tx.insert(studentLeaves).values(
      todo.map((studentId) => ({
        studentId,
        academicYearId: input.academicYearId,
        leaveType: input.leaveType,
        startDate: norm(input.startDate),
        expectedReturnDate: norm(input.expectedReturnDate),
        reason: norm(input.reason),
        orderNo: norm(input.orderNo),
        note: norm(input.note),
      })),
    );
    return { created: todo.length, skipped: [...skip] };
  });
}

/**
 * Close an episode — the student is back. Only an open episode can be closed,
 * so a double submit cannot overwrite an already-recorded return date.
 */
export async function endLeave(
  leaveId: number,
  returnedDate: string,
  note?: string | null,
): Promise<boolean> {
  const set: Record<string, unknown> = { returnedDate: norm(returnedDate) };
  const n = norm(note);
  if (n) set.note = n;
  const rows = await db
    .update(studentLeaves)
    .set(set)
    .where(and(eq(studentLeaves.id, leaveId), isNull(studentLeaves.returnedDate)))
    .returning({ id: studentLeaves.id });
  return rows.length > 0;
}

/** Undo a leave recorded by mistake. Deletes the episode outright. */
export async function deleteLeave(leaveId: number): Promise<boolean> {
  const rows = await db
    .delete(studentLeaves)
    .where(eq(studentLeaves.id, leaveId))
    .returning({ id: studentLeaves.id });
  return rows.length > 0;
}

/** Count of students currently on leave — for the dashboard tile. */
export async function countOnLeave(): Promise<number> {
  const [res] = await db
    .select({ n: sql<number>`count(*)` })
    .from(studentLeaves)
    .innerJoin(students, eq(students.id, studentLeaves.studentId))
    .where(and(isNull(studentLeaves.returnedDate), eq(students.isArchived, false)));
  return Number(res?.n ?? 0);
}

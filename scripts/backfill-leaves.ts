/**
 * One-shot: move the students who were recorded as พักการเรียน through the
 * จำหน่าย/ลาออก workflow into the new `student_leaves` table.
 *
 *   npm run backfill:leaves -- --dry    # show what would change (default)
 *   npm run backfill:leaves -- --apply  # actually write
 *
 * WHY: before the พักการเรียน page existed, a suspension was stored as
 * `status = 'withdrawn'` with `exit_type = 'พักการเรียน'`. That marked the
 * student as having LEFT the school — off the class roll, held back by the
 * year-end promotion, and counted in the จำหน่าย register they never belonged
 * in. A leave is temporary, so each of those rows becomes an open leave episode
 * and the student goes back to `status = 'studying'` with their exit fields
 * cleared. The exit date becomes the leave's start date; the exit reason and
 * exit year carry over.
 *
 * Anyone who was suspended and has since genuinely left will need to be
 * withdrawn again by hand — the old row cannot say which of the two happened,
 * and guessing would be worse than asking. The script prints every student it
 * touches so that list is easy to check.
 *
 * Safe to re-run: students who already have an open leave episode are skipped.
 */
import 'dotenv/config';
import { and, eq, isNull } from 'drizzle-orm';
import { db, sql } from '../src/db';
import { students, studentLeaves } from '../src/db/schema';

async function main() {
  const apply = process.argv.includes('--apply');

  const rows = await db
    .select({
      id: students.id,
      studentCode: students.studentCode,
      firstName: students.firstName,
      lastName: students.lastName,
      exitDate: students.exitDate,
      exitReason: students.exitReason,
      exitAcademicYearId: students.exitAcademicYearId,
    })
    .from(students)
    .where(and(eq(students.status, 'withdrawn'), eq(students.exitType, 'พักการเรียน')));

  if (!rows.length) {
    console.log('[backfill] ไม่พบรายการ exit_type = "พักการเรียน" — ไม่ต้องทำอะไร');
    await sql.end();
    return;
  }

  // Re-running must not open a second episode for the same student.
  const open = await db
    .select({ studentId: studentLeaves.studentId })
    .from(studentLeaves)
    .where(isNull(studentLeaves.returnedDate));
  const alreadyOpen = new Set(open.map((r) => r.studentId));

  const todo = rows.filter((r) => !alreadyOpen.has(r.id));
  const skipped = rows.length - todo.length;

  console.log(`[backfill] พบ ${rows.length} รายการ · จะย้าย ${todo.length}${skipped ? ` · ข้าม ${skipped} (มีรายการพักค้างอยู่แล้ว)` : ''}`);
  for (const r of todo) {
    console.log(`  ${r.studentCode} ${r.firstName} ${r.lastName} — พักตั้งแต่ ${r.exitDate ?? '-'} (${r.exitReason ?? '-'})`);
  }

  if (!apply) {
    console.log('[backfill] DRY RUN — ยังไม่ได้เขียนลงฐานข้อมูล ใส่ --apply เพื่อบันทึกจริง');
    await sql.end();
    return;
  }

  if (todo.length) {
    await db.transaction(async (tx) => {
      await tx.insert(studentLeaves).values(
        todo.map((r) => ({
          studentId: r.id,
          academicYearId: r.exitAcademicYearId,
          leaveType: 'พักการเรียน',
          startDate: r.exitDate,
          reason: r.exitReason,
          note: 'ย้ายมาจากรายการจำหน่าย/ลาออกเดิม (backfill)',
        })),
      );
      for (const r of todo) {
        await tx
          .update(students)
          .set({
            status: 'studying',
            exitType: null,
            exitReason: null,
            exitDate: null,
            exitAcademicYearId: null,
          })
          .where(eq(students.id, r.id));
      }
    });
  }

  console.log(`[backfill] เสร็จสิ้น — ย้าย ${todo.length} รายการ, คืนสถานะ "กำลังศึกษา" ให้แล้ว`);
  console.log('[backfill] ตรวจสอบที่หน้า /users/leaves — ถ้ามีใครออกไปจริงแล้ว ให้จำหน่ายใหม่ที่หน้า /users/withdrawals');
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

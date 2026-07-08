/**
 * One-off migration: students XLSX -> students + enrollments (+ addresses,
 * guardians, previous school, health) for academic year 2569.
 *
 *   npm run seed:students            # imports .example/students.xlsx
 *   npm run seed:students -- path.xlsx [year]
 *
 * Sensitive fields (citizen_id, password, income) are encrypted on insert.
 * Idempotent: re-running upserts by student_code.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, sql } from '../src/db';
import { academicYears } from '../src/db/schema';
import { parseStudentRow } from '../src/lib/excel-map';
import { readSheetRows } from '../src/lib/excel-io';
import { upsertStudentFull } from '../src/lib/services/students';

async function ensureYear(year: number): Promise<number> {
  const existing = await db.query.academicYears.findFirst({
    where: eq(academicYears.year, year),
  });
  if (existing) {
    if (!existing.isActive) {
      await db.update(academicYears).set({ isActive: false });
      await db.update(academicYears).set({ isActive: true }).where(eq(academicYears.id, existing.id));
    }
    return existing.id;
  }
  await db.update(academicYears).set({ isActive: false });
  const [row] = await db
    .insert(academicYears)
    .values({ year, isActive: true })
    .returning({ id: academicYears.id });
  return row.id;
}

async function main() {
  const file = process.argv[2] ?? path.resolve(process.cwd(), '.example/students.xlsx');
  const year = Number(process.argv[3] ?? '2569');
  console.log(`[students] reading ${file} (year ${year})`);

  const yearId = await ensureYear(year);
  const buf = await readFile(file);
  const rows = await readSheetRows(buf);
  console.log(`[students] ${rows.length} data rows`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let i = 0;

  for (const raw of rows) {
    i++;
    const parsed = parseStudentRow(raw);
    if (!parsed) { skipped++; continue; }
    try {
      const res = await upsertStudentFull(parsed, yearId);
      if (res.created) created++;
      else updated++;
    } catch (err) {
      console.error(`[students] row ${i} (${parsed.core.studentCode}) failed:`, (err as Error).message);
      skipped++;
    }
    if (i % 200 === 0) console.log(`  ... processed ${i}/${rows.length}`);
  }

  console.log(`[students] done - created ${created}, updated ${updated}, skipped ${skipped}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

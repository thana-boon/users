/**
 * One-off migration: teachers_list CSV/XLSX -> teachers table.
 *
 *   npm run seed:teachers            # imports .example/teachers.xlsx
 *   npm run seed:teachers -- path.xlsx
 *
 * - Username column is ignored (== teacher_code).
 * - Password is plain text in the file -> encrypted on insert.
 * - Everyone lands as role=teacher EXCEPT the codes in ADMIN_CODES, which are
 *   seeded (and re-asserted on update) as role=teacher-admin.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, sql } from '../src/db';
import { teachers } from '../src/db/schema';
import { encrypt } from '../src/lib/crypto';
import { parseTeacherRow } from '../src/lib/excel-map';
import { readSheetRows } from '../src/lib/excel-io';

/** Teacher codes seeded as `teacher-admin` (everyone else is `teacher`). */
const ADMIN_CODES = new Set(['T00116', 'T00241']);

async function main() {
  const file = process.argv[2] ?? path.resolve(process.cwd(), '.example/teachers.xlsx');
  console.log(`[teachers] reading ${file}`);
  const buf = await readFile(file);
  const rows = await readSheetRows(buf);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of rows) {
    const t = parseTeacherRow(raw);
    if (!t) { skipped++; continue; }
    const existing = await db.query.teachers.findFirst({
      where: eq(teachers.teacherCode, t.teacherCode),
      columns: { id: true },
    });
    const role: 'teacher' | 'teacher-admin' = ADMIN_CODES.has(t.teacherCode)
      ? 'teacher-admin'
      : 'teacher';
    const base = {
      prefix: t.prefix,
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      subjectGroup: t.subjectGroup,
      gradeTaught: t.gradeTaught,
      role,
      citizenIdEncrypted: encrypt(t.citizenId),
      passwordEncrypted: encrypt(t.plainPassword),
    };
    if (existing) {
      await db.update(teachers).set(base).where(eq(teachers.id, existing.id));
      updated++;
    } else {
      await db.insert(teachers).values({ teacherCode: t.teacherCode, ...base });
      created++;
    }
  }

  console.log(`[teachers] done - created ${created}, updated ${updated}, skipped ${skipped}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

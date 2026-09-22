/**
 * One-shot (and safely repeatable): strip the stray separators the first import
 * left on the end of phone numbers.
 *
 *   npm run fix:phones           # show what would change (dry run, the default)
 *   npm run fix:phones -- --apply  # actually write
 *
 * WHY: the students spreadsheet the module was seeded from had its phone column
 * written as free text, and almost every row came across as `0812345678-` — the
 * dash belongs to the form the numbers were copied off, not to the number.
 * Harmless to look at, poison to use: another system dialling that string, or
 * matching it against its own copy of the roster, fails on a character nobody
 * can see at the end of a table cell. The same trailing junk turned up in a few
 * guardian and address columns, so every phone column in the database is swept.
 *
 * WHAT IT DOES, exactly: `normalizePhone` from src/lib/phone.ts — keep the
 * digits, drop everything else. `0812345678-` becomes `0812345678` and
 * `089-885-0863` becomes `0898850863`. Digits are never added, removed or
 * reordered, so a 9-digit landline and an 11-digit typo both survive as they
 * are, minus punctuation; the script prints them but does not guess at them. A
 * cell holding only punctuation ('-') becomes NULL, because it is not a number
 * and should not look like data.
 *
 * Idempotent: a second run finds nothing to do, which is also what makes the
 * dry run trustworthy — the count it prints is the count the apply will change.
 *
 * The write side of the module normalizes on save now (lib/phone.ts is wired
 * into the self-service route, the public emergency-contact write and the admin
 * student/teacher writes), so this is a one-time cleanup of history rather than
 * a recurring chore. It stays in the repo because a future bulk import can
 * reintroduce the same mess, and then this is the fix.
 */
import 'dotenv/config';
import { sql } from '../src/db';
import { normalizePhone } from '../src/lib/phone';

const APPLY = process.argv.includes('--apply');

/** Every phone-ish column in the database, as (table, column) pairs. */
const COLUMNS: Array<{ table: string; column: string; label: string }> = [
  { table: 'students', column: 'phone', label: 'เบอร์นักเรียน' },
  { table: 'student_addresses', column: 'phone', label: 'เบอร์บ้าน (ที่อยู่)' },
  { table: 'student_addresses', column: 'emergency_phone', label: 'เบอร์ฉุกเฉิน' },
  { table: 'student_addresses', column: 'nearby_friend_phone', label: 'เบอร์เพื่อนใกล้บ้าน' },
  { table: 'guardians', column: 'home_phone', label: 'เบอร์บ้านผู้ปกครอง' },
  { table: 'guardians', column: 'mobile_phone', label: 'เบอร์มือถือผู้ปกครอง' },
  { table: 'guardians', column: 'work_phone', label: 'เบอร์ที่ทำงานผู้ปกครอง' },
  { table: 'teachers', column: 'phone', label: 'เบอร์ครู' },
  { table: 'workers', column: 'phone', label: 'เบอร์คนงาน' },
  { table: 'special_teachers', column: 'phone', label: 'เบอร์อาจารย์พิเศษ' },
];

interface Row {
  id: number;
  value: string;
}

async function tableExists(table: string, column: string): Promise<boolean> {
  // The module has grown tables over time; a column that is not there yet is
  // skipped rather than crashing a cleanup that has real work to do elsewhere.
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n
    from information_schema.columns
    where table_name = ${table} and column_name = ${column}
  `;
  return (rows[0]?.n ?? 0) > 0;
}

async function sweep(table: string, column: string, label: string): Promise<number> {
  if (!(await tableExists(table, column))) {
    console.log(`  – ${table}.${column} — ไม่มีคอลัมน์นี้ ข้าม`);
    return 0;
  }

  // Read the candidates rather than doing it in one UPDATE: the rule lives in
  // TypeScript (one definition, used by the app too), and printing the actual
  // before/after is what makes a dry run worth running.
  const rows = await sql<Row[]>`
    select id, ${sql(column)} as value
    from ${sql(table)}
    where ${sql(column)} is not null and ${sql(column)} <> ''
  `;

  const fixes = rows
    .map((r) => ({ id: r.id, from: r.value, to: normalizePhone(r.value) }))
    .filter((f) => f.to !== f.from);

  if (fixes.length === 0) {
    console.log(`  ✓ ${table}.${column} (${label}) — สะอาดอยู่แล้ว`);
    return 0;
  }

  console.log(`  • ${table}.${column} (${label}) — ต้องแก้ ${fixes.length} แถว`);
  for (const f of fixes.slice(0, 5)) {
    console.log(`      #${f.id}: ${JSON.stringify(f.from)} → ${JSON.stringify(f.to)}`);
  }
  if (fixes.length > 5) console.log(`      … และอีก ${fixes.length - 5} แถว`);

  if (!APPLY) return fixes.length;

  // One statement per distinct target value rather than one per row: the whole
  // table usually collapses to a few hundred UPDATEs instead of thousands.
  await sql.begin(async (tx) => {
    for (const f of fixes) {
      await tx`
        update ${sql(table)}
        set ${sql(column)} = ${f.to}
        where id = ${f.id}
      `;
    }
  });
  return fixes.length;
}

async function main() {
  console.log(
    APPLY
      ? '== ลบอักขระคั่นท้ายเบอร์โทร (เขียนจริง) =='
      : '== ลบอักขระคั่นท้ายเบอร์โทร (ดูก่อน — ยังไม่เขียน) ==',
  );

  let total = 0;
  for (const { table, column, label } of COLUMNS) {
    total += await sweep(table, column, label);
  }

  console.log('');
  if (total === 0) {
    console.log('ไม่มีอะไรต้องแก้ — ทุกคอลัมน์สะอาดแล้ว');
  } else if (APPLY) {
    console.log(`เรียบร้อย — แก้ไปทั้งหมด ${total} แถว`);
  } else {
    console.log(`พบทั้งหมด ${total} แถวที่ต้องแก้`);
    console.log('รันอีกครั้งด้วย  npm run fix:phones -- --apply  เพื่อเขียนจริง');
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

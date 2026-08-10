import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { GRADE_ORDER } from './grades';

/**
 * SQL ordering helpers for ชั้น / ห้อง.
 *
 * `ORDER BY grade_level` sorts by Thai code points, which puts ป before ม
 * before อ and drops เตรียมอนุบาล last — the exact opposite of how a school
 * reads a roster. Every list that shows ชั้น must order by curriculum position
 * instead, so this emits the same ranking `GRADE_ORDER` gives the client
 * (`compareGrades`) as a CASE expression the database can sort on.
 *
 * Kept out of src/lib/grades.ts on purpose: that module is imported by client
 * components, and pulling drizzle-orm into the browser bundle for a sort key is
 * not a trade worth making.
 */

/** Curriculum position of a ชั้น column; unknown/NULL grades sort last. */
export function gradeRank(col: AnyColumn | SQL): SQL<number> {
  const whens = GRADE_ORDER.map(
    (g, i) => sql`when ${col} = ${g} then ${sql.raw(String(i))}`,
  );
  return sql<number>`case ${sql.join(whens, sql` `)} else 999 end`;
}

/**
 * Numeric position of a ห้อง column, so ห้อง 2 comes before ห้อง 10 (text sort
 * puts '10' first). Rooms with no digits at all fall back to 999 and are then
 * broken by `roomText` below.
 */
export function roomRank(col: AnyColumn | SQL): SQL<number> {
  return sql<number>`coalesce(nullif(regexp_replace(${col}, '\\D', '', 'g'), '')::int, 999)`;
}

/** Tie-breaker for rooms that share a number (e.g. '1/พิเศษ') or have none. */
export function roomText(col: AnyColumn | SQL): SQL<string> {
  return sql<string>`coalesce(${col}, '')`;
}

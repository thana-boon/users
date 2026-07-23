import type { NextRequest } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { academicYears } from '@/db/schema';
import { requireApiScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/academic-years — the school calendar for other systems:
 * every academic year with its overall window and the two term windows, as
 * maintained on the /users/academic-years page.
 *
 * Auth: `years:read` — its own scope (not piggybacked on students/teachers)
 * because calendar consumers (timetables, attendance, grading) often should
 * NOT be able to pull the roster. No PII anywhere in the payload.
 *
 * Query: ?year=2569 (Thai Buddhist year) | ?active=1 (only the active year)
 * Archived years are never returned. Dates are ISO yyyy-mm-dd or null when the
 * school has not filled them in yet. No pagination — a school has a handful of
 * years.
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'years:read');
  if (!guard.ok) return guard.response;

  try {
    const sp = req.nextUrl.searchParams;
    const conds = [eq(academicYears.isArchived, false)];
    if (sp.get('active') === '1') conds.push(eq(academicYears.isActive, true));
    const year = sp.get('year');
    if (year) conds.push(eq(academicYears.year, Number(year)));

    const rows = await db
      .select({
        id: academicYears.id,
        year: academicYears.year,
        startDate: academicYears.startDate,
        endDate: academicYears.endDate,
        term1Start: academicYears.term1Start,
        term1End: academicYears.term1End,
        term2Start: academicYears.term2Start,
        term2End: academicYears.term2End,
        isActive: academicYears.isActive,
      })
      .from(academicYears)
      .where(and(...conds))
      .orderBy(desc(academicYears.year));

    const data = rows.map((r) => ({
      id: r.id,
      year: r.year,
      startDate: r.startDate,
      endDate: r.endDate,
      isActive: r.isActive,
      terms: [
        { term: 1, startDate: r.term1Start, endDate: r.term1End },
        { term: 2, startDate: r.term2Start, endDate: r.term2End },
      ],
    }));

    return ok({ data });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { and, asc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireApiScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/special-teachers — อาจารย์พิเศษ roster for other SchoolOS
 * systems (ตารางสอน, เกียรติบัตร, ฯลฯ).
 *
 * Auth: `special-teachers:read`. There is no `:pii` twin — an อาจารย์พิเศษ has
 * no login and no เลขบัตร ปชช., so there is nothing here to gate behind one.
 * Photos DO exist and ride the additive `special-teachers:photo` scope on
 * `/[id]/photo` and `/photos`; this route only reports whether one is there.
 *
 * Query: ?subjectGroup= ?q= ?page= ?pageSize= (max 200)
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'special-teachers:read');
  if (!guard.ok) return guard.response;

  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const subjectGroup = (sp.get('subjectGroup') ?? '').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize') ?? '50') || 50));

    const conds = [eq(specialTeachers.isArchived, false)];
    if (subjectGroup) conds.push(eq(specialTeachers.subjectGroup, subjectGroup));
    if (q) {
      conds.push(
        or(
          ilike(specialTeachers.firstName, `%${q}%`),
          ilike(specialTeachers.lastName, `%${q}%`),
          ilike(specialTeachers.specialTeacherCode, `%${q}%`),
          ilike(specialTeachers.subjectGroup, `%${q}%`),
        )!,
      );
    }
    const where = and(...conds);

    const [rows, countRes] = await Promise.all([
      db
        .select({
          id: specialTeachers.id,
          specialTeacherCode: specialTeachers.specialTeacherCode,
          prefix: specialTeachers.prefix,
          firstName: specialTeachers.firstName,
          lastName: specialTeachers.lastName,
          subjectGroup: specialTeachers.subjectGroup,
          phone: specialTeachers.phone,
          hasPhoto: isNotNull(specialTeachers.photoBase64),
        })
        .from(specialTeachers)
        .where(where)
        .orderBy(asc(specialTeachers.specialTeacherCode))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)` }).from(specialTeachers).where(where),
    ]);

    const data = rows.map((r) => ({
      ...r,
      fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
    }));

    return ok({ data, page, pageSize, total: Number(countRes[0]?.n ?? 0) });
  } catch (err) {
    return handleError(err);
  }
}

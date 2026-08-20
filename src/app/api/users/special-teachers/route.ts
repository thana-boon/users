import type { NextRequest } from 'next/server';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, created, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * อาจารย์พิเศษ — the roster of visiting teachers. They have no login, so the
 * row carries no password, no role and nothing encrypted: รหัส + ชื่อ + the
 * กลุ่มสาระ they teach under is the whole record. That is also why there is no
 * /reveal twin of this route — there is nothing here to reveal.
 *
 * GET  /api/users/special-teachers  ?q= ?subjectGroup= ?page= ?pageSize=
 * POST /api/users/special-teachers
 */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const subjectGroup = (sp.get('subjectGroup') ?? '').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '25') || 25));

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
        })
        .from(specialTeachers)
        .where(where)
        .orderBy(asc(specialTeachers.specialTeacherCode))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)` }).from(specialTeachers).where(where),
    ]);

    return ok({ data: rows, page, pageSize, total: Number(countRes[0]?.n ?? 0) });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  specialTeacherCode: z.string().min(1),
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  subjectGroup: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = createSchema.parse(await req.json());
    const code = body.specialTeacherCode.trim();
    if (!code) return badRequest('กรุณากรอกรหัสอาจารย์พิเศษ');

    const dup = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.specialTeacherCode, code),
      columns: { id: true },
    });
    if (dup) return badRequest('รหัสอาจารย์พิเศษนี้มีในระบบแล้ว');

    const [row] = await db
      .insert(specialTeachers)
      .values({
        specialTeacherCode: code,
        prefix: body.prefix ?? null,
        firstName: body.firstName,
        lastName: body.lastName,
        subjectGroup: body.subjectGroup?.trim() || null,
        phone: body.phone?.trim() || null,
      })
      .returning({ id: specialTeachers.id });

    await recordAudit({
      session: guard.session,
      action: 'create',
      targetType: 'special_teacher',
      targetId: row.id,
      targetLabel: `${code} ${body.firstName} ${body.lastName}`,
      detail: body.subjectGroup ? `กลุ่มสาระ: ${body.subjectGroup}` : null,
      req,
    });
    return created({ id: row.id });
  } catch (err) {
    return handleError(err);
  }
}

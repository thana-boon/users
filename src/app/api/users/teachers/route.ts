import type { NextRequest } from 'next/server';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, created, badRequest, handleError } from '@/lib/http';
import { encrypt } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const subject = (sp.get('subjectGroup') ?? '').trim();
    const role = (sp.get('role') ?? '').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '25') || 25));

    const conds = [eq(teachers.isArchived, false)];
    if (subject) conds.push(eq(teachers.subjectGroup, subject));
    if (role === 'teacher' || role === 'teacher-admin')
      conds.push(eq(teachers.role, role));
    if (q) {
      conds.push(
        or(
          ilike(teachers.firstName, `%${q}%`),
          ilike(teachers.lastName, `%${q}%`),
          ilike(teachers.teacherCode, `%${q}%`),
          ilike(teachers.email, `%${q}%`),
        )!,
      );
    }
    const where = and(...conds);

    const [rows, countRes] = await Promise.all([
      db
        .select({
          id: teachers.id,
          teacherCode: teachers.teacherCode,
          prefix: teachers.prefix,
          firstName: teachers.firstName,
          lastName: teachers.lastName,
          email: teachers.email,
          subjectGroup: teachers.subjectGroup,
          gradeTaught: teachers.gradeTaught,
          role: teachers.role,
        })
        .from(teachers)
        .where(where)
        .orderBy(teachers.teacherCode)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)` }).from(teachers).where(where),
    ]);

    return ok({ data: rows, page, pageSize, total: Number(countRes[0]?.n ?? 0) });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  teacherCode: z.string().min(1),
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().nullable().optional(),
  subjectGroup: z.string().nullable().optional(),
  gradeTaught: z.string().nullable().optional(),
  role: z.enum(['teacher', 'teacher-admin']).default('teacher'),
  citizenId: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = createSchema.parse(await req.json());
    const dup = await db.query.teachers.findFirst({
      where: eq(teachers.teacherCode, body.teacherCode),
      columns: { id: true },
    });
    if (dup) return badRequest('รหัสครูนี้มีในระบบแล้ว');

    const [row] = await db
      .insert(teachers)
      .values({
        teacherCode: body.teacherCode,
        prefix: body.prefix ?? null,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email ?? null,
        subjectGroup: body.subjectGroup ?? null,
        gradeTaught: body.gradeTaught ?? null,
        role: body.role,
        citizenIdEncrypted: encrypt(body.citizenId ?? null),
        passwordEncrypted: encrypt(body.password ?? null),
      })
      .returning({ id: teachers.id });

    await recordAudit({
      session: guard.session,
      action: 'create',
      targetType: 'teacher',
      targetId: row.id,
      targetLabel: `${body.teacherCode} ${body.firstName} ${body.lastName}`,
      req,
    });
    return created({ id: row.id });
  } catch (err) {
    return handleError(err);
  }
}

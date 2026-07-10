import type { NextRequest } from 'next/server';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { workers } from '@/db/schema';
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
    const status = (sp.get('status') ?? '').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '25') || 25));

    const conds = [eq(workers.isArchived, false)];
    if (status === 'active' || status === 'resigned')
      conds.push(eq(workers.employmentStatus, status));
    if (q) {
      conds.push(
        or(
          ilike(workers.firstName, `%${q}%`),
          ilike(workers.lastName, `%${q}%`),
          ilike(workers.workerCode, `%${q}%`),
          ilike(workers.position, `%${q}%`),
        )!,
      );
    }
    const where = and(...conds);

    const [rows, countRes] = await Promise.all([
      db
        .select({
          id: workers.id,
          workerCode: workers.workerCode,
          prefix: workers.prefix,
          firstName: workers.firstName,
          lastName: workers.lastName,
          position: workers.position,
          phone: workers.phone,
          employmentStatus: workers.employmentStatus,
        })
        .from(workers)
        .where(where)
        .orderBy(workers.workerCode)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)` }).from(workers).where(where),
    ]);

    return ok({ data: rows, page, pageSize, total: Number(countRes[0]?.n ?? 0) });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  workerCode: z.string().min(1),
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  position: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  citizenId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = createSchema.parse(await req.json());
    const dup = await db.query.workers.findFirst({
      where: eq(workers.workerCode, body.workerCode),
      columns: { id: true },
    });
    if (dup) return badRequest('รหัสคนงานนี้มีในระบบแล้ว');

    const [row] = await db
      .insert(workers)
      .values({
        workerCode: body.workerCode,
        prefix: body.prefix ?? null,
        firstName: body.firstName,
        lastName: body.lastName,
        position: body.position ?? null,
        phone: body.phone ?? null,
        citizenIdEncrypted: encrypt(body.citizenId ?? null),
      })
      .returning({ id: workers.id });

    await recordAudit({
      session: guard.session,
      action: 'create',
      targetType: 'worker',
      targetId: row.id,
      targetLabel: `${body.workerCode} ${body.firstName} ${body.lastName}`,
      req,
    });
    return created({ id: row.id });
  } catch (err) {
    return handleError(err);
  }
}

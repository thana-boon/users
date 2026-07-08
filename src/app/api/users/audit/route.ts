import type { NextRequest } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';

export const runtime = 'nodejs';

/** GET /api/users/audit?action=&targetType=&page= — read the audit trail. */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const action = (sp.get('action') ?? '').trim();
    const targetType = (sp.get('targetType') ?? '').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '50') || 50));

    const conds = [];
    if (action) conds.push(eq(auditLogs.action, action));
    if (targetType) conds.push(eq(auditLogs.targetType, targetType));
    const where = conds.length ? and(...conds) : undefined;

    const [rows, countRes] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)` }).from(auditLogs).where(where),
    ]);

    return ok({ data: rows, page, pageSize, total: Number(countRes[0]?.n ?? 0) });
  } catch (err) {
    return handleError(err);
  }
}

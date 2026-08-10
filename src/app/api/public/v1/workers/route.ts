import type { NextRequest } from 'next/server';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { workers } from '@/db/schema';
import { requireApiScope, actorHasScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { tryDecrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/workers — คนงาน (support staff) roster for other SchoolOS
 * systems.
 *
 * Auth: `workers:read`; เลขบัตร ปชช. needs the additive `workers:pii`.
 * photo_base64 is never returned here (same reasoning as students/teachers) —
 * photos come from ./[id]/photo or ./photos?ids= under `workers:photo`, and
 * `hasPhoto`/`photoUrl` say who has one.
 *
 * Workers are their own table precisely because they carry no login: there is
 * no `role`, no email, and no password to leak, so the row is identity +
 * ตำแหน่ง + employment status. Nothing here can authorize anybody.
 *
 * Query: ?position= ?status= ?q= ?page= ?pageSize= (max 200)
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'workers:read');
  if (!guard.ok) return guard.response;

  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const position = (sp.get('position') ?? '').trim();
    const status = (sp.get('status') ?? 'active').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize') ?? '50') || 50));

    const withPii = actorHasScope(guard.actor, 'workers:pii');

    const conds = [eq(workers.isArchived, false)];
    if (position) conds.push(eq(workers.position, position));
    if (status !== 'all' && (status === 'active' || status === 'resigned')) {
      conds.push(eq(workers.employmentStatus, status));
    }
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
          exitDate: workers.exitDate,
          citizenIdEncrypted: workers.citizenIdEncrypted,
          hasPhoto: sql<boolean>`${workers.photoBase64} is not null`,
        })
        .from(workers)
        .where(where)
        .orderBy(asc(workers.workerCode))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)` }).from(workers).where(where),
    ]);

    const data = rows.map((r) => {
      const { citizenIdEncrypted, ...rest } = r;
      return {
        ...rest,
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        photoUrl: r.hasPhoto ? `/api/public/v1/workers/${r.id}/photo` : null,
        ...(withPii ? { citizenId: tryDecrypt(citizenIdEncrypted) } : {}),
      };
    });

    if (withPii && data.length > 0) {
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: 'reveal_citizen_id',
        targetType: 'worker',
        targetLabel: `public API · ${data.length} รายการ`,
        detail: `GET /api/public/v1/workers?${sp.toString()}`,
        req,
      });
    }

    return ok({ data, page, pageSize, total: Number(countRes[0]?.n ?? 0) });
  } catch (err) {
    return handleError(err);
  }
}

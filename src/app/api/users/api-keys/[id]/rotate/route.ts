import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { rotateApiKey } from '@/lib/services/apikeys';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/users/api-keys/[id]/rotate — issue a new secret for an existing key.
 *
 * The old value stops working the moment this returns (the hash it matched on
 * is overwritten), so the consuming system must be updated immediately.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const res = await rotateApiKey(id);
    if (!res) return notFound('ไม่พบ API key นี้');

    await recordAudit({
      session: guard.session,
      action: 'rotate_api_key',
      targetType: 'api_key',
      targetId: id,
      targetLabel: `${res.summary.name} (${res.summary.keyPrefix})`,
      req,
    });

    return ok({ ...res.summary, plain: res.plain });
  } catch (err) {
    return handleError(err);
  }
}

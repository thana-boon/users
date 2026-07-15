import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { revealApiKey } from '@/lib/services/apikeys';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/users/api-keys/[id]/reveal — decrypt and return the full key.
 *
 * Mirrors the student/teacher password reveal: the value is recoverable by
 * design (an admin must be able to hand it back), and the trade-off is paid for
 * with an audit row on EVERY reveal. Audited before the value is returned so a
 * failed write can never yield an unlogged disclosure.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const found = await revealApiKey(id);
    if (!found) return notFound('ไม่พบ API key นี้');

    await recordAudit({
      session: guard.session,
      action: 'reveal_api_key',
      targetType: 'api_key',
      targetId: id,
      targetLabel: found.name,
      req,
    });

    return ok({ plain: found.plain });
  } catch (err) {
    return handleError(err);
  }
}

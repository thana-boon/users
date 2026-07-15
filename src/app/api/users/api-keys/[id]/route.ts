import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { API_SCOPES } from '@/lib/apikey';
import { getApiKey, updateApiKey, deleteApiKey } from '@/lib/services/apikeys';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const row = await getApiKey(Number((await params).id));
    if (!row) return notFound('ไม่พบ API key นี้');
    return ok(row);
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(500).nullable().optional(),
  scopes: z.array(z.enum(API_SCOPES)).min(1).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/** PATCH — rename, re-scope, set expiry, or enable/disable (revoke). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = patchSchema.parse(await req.json());

    const row = await updateApiKey(id, {
      ...body,
      expiresAt:
        body.expiresAt === undefined
          ? undefined
          : body.expiresAt === null
            ? null
            : new Date(body.expiresAt),
    });
    if (!row) return notFound('ไม่พบ API key นี้');

    // Flipping isActive is a security event in its own right, so it is audited
    // as a revoke/reinstate rather than a generic update.
    const action =
      body.isActive === false ? 'revoke_api_key' : body.isActive === true ? 'reinstate' : 'update';
    await recordAudit({
      session: guard.session,
      action,
      targetType: 'api_key',
      targetId: row.id,
      targetLabel: `${row.name} (${row.keyPrefix})`,
      detail: body.scopes ? `scopes: ${body.scopes.join(', ')}` : null,
      req,
    });

    return ok(row);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * DELETE — permanently remove a key.
 *
 * Revoking (PATCH isActive:false) is preferred and is what the UI offers by
 * default: it keeps the row so the audit trail still resolves the key's name.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const row = await deleteApiKey(Number((await params).id));
    if (!row) return notFound('ไม่พบ API key นี้');

    await recordAudit({
      session: guard.session,
      action: 'delete',
      targetType: 'api_key',
      targetId: row.id,
      targetLabel: `${row.name} (${row.keyPrefix})`,
      req,
    });
    return ok({ id: row.id });
  } catch (err) {
    return handleError(err);
  }
}

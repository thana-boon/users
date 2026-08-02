import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { API_SCOPES } from '@/lib/apikey';
import { AUDIENCE_PATTERN, needsAudience } from '@/lib/api-scopes';
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
  handoffAudience: z.string().regex(AUDIENCE_PATTERN).nullable().optional(),
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

    // Both halves of the handoff rule are patchable one at a time, so the check
    // runs against the state the key would END UP in — granting the scope and
    // clearing the audience in two calls must not slip past it.
    const current = await getApiKey(id);
    if (!current) return notFound('ไม่พบ API key นี้');
    const scopes = body.scopes ?? current.scopes;
    const audience =
      body.handoffAudience !== undefined ? body.handoffAudience : current.handoffAudience;
    if (needsAudience(scopes) && !audience) {
      return badRequest('สิทธิ์ auth:handoff ต้องระบุระบบปลายทาง (audience) ด้วย');
    }

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
      detail:
        [
          body.scopes ? `scopes: ${body.scopes.join(', ')}` : null,
          body.handoffAudience !== undefined ? `audience: ${body.handoffAudience ?? '—'}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
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

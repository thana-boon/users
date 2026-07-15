import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, created, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { API_SCOPES } from '@/lib/apikey';
import { listApiKeys, createApiKey, apiKeyStats, type KeyStatus } from '@/lib/services/apikeys';

export const runtime = 'nodejs';

/** GET /api/users/api-keys — list keys (never includes the secret) + header stats. */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const status = (sp.get('status') ?? '') as KeyStatus | '';
    const [data, stats] = await Promise.all([
      listApiKeys({ q: sp.get('q') ?? '', status }),
      apiKeyStats(),
    ]);
    return ok({ data, stats });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  name: z.string().min(1, 'ต้องระบุชื่อระบบ').max(128),
  description: z.string().max(500).nullable().optional(),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'ต้องเลือกสิทธิ์อย่างน้อย 1 รายการ'),
  // ISO date string, or null = ไม่มีวันหมดอายุ
  expiresAt: z.string().datetime().nullable().optional(),
});

/**
 * POST /api/users/api-keys — mint a key.
 *
 * The plaintext in this response is the ONLY unaudited copy the admin ever
 * sees; afterwards it costs an audited reveal. The key itself is never logged.
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = createSchema.parse(await req.json());
    const { summary, plain } = await createApiKey({
      name: body.name,
      description: body.description ?? null,
      scopes: body.scopes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      createdByLabel: guard.session.sub,
    });

    await recordAudit({
      session: guard.session,
      action: 'create_api_key',
      targetType: 'api_key',
      targetId: summary.id,
      targetLabel: `${summary.name} (${summary.keyPrefix})`,
      detail: `scopes: ${body.scopes.join(', ')}`,
      req,
    });

    return created({ ...summary, plain });
  } catch (err) {
    return handleError(err);
  }
}

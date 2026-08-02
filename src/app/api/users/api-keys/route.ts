import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, created, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { API_SCOPES } from '@/lib/apikey';
import { AUDIENCE_PATTERN, needsAudience } from '@/lib/api-scopes';
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
  // ชื่อระบบปลายทางของ `auth:handoff` เช่น "arena" — ต้องตรงกับ ?audience= ที่
  // เบราว์เซอร์ใช้ขอโค้ด เทียบแบบตรงตัว
  handoffAudience: z
    .string()
    .regex(AUDIENCE_PATTERN, 'audience ต้องเป็น a-z 0-9 - _ เท่านั้น')
    .nullable()
    .optional(),
  // ISO date string, หรือ null = ไม่มีวันหมดอายุ
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
    // A handoff key with no audience can redeem nothing (the route fails closed),
    // so refuse it here rather than issuing a key that looks fine and is not.
    if (needsAudience(body.scopes) && !body.handoffAudience) {
      return badRequest('สิทธิ์ auth:handoff ต้องระบุระบบปลายทาง (audience) ด้วย');
    }
    const { summary, plain } = await createApiKey({
      name: body.name,
      description: body.description ?? null,
      scopes: body.scopes,
      handoffAudience: body.handoffAudience ?? null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      createdByLabel: guard.session.sub,
    });

    await recordAudit({
      session: guard.session,
      action: 'create_api_key',
      targetType: 'api_key',
      targetId: summary.id,
      targetLabel: `${summary.name} (${summary.keyPrefix})`,
      detail: `scopes: ${body.scopes.join(', ')}${
        summary.handoffAudience ? ` · audience: ${summary.handoffAudience}` : ''
      }`,
      req,
    });

    return created({ ...summary, plain });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAccess } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import {
  PREFIX_AGE,
  applyPrefixUpdate,
  findCandidates,
  readCutoff,
  saveCutoff,
  validCutoff,
} from '@/lib/services/prefix-update';

export const runtime = 'nodejs';

/**
 * GET  /api/users/prefix-update — the cutoff day and who would change under it.
 * POST /api/users/prefix-update — { day, month, apply }: save the cutoff, and
 *      when `apply` is true also rewrite the prefixes.
 *
 * The student list is always re-derived on the server from the saved cutoff, so
 * what is applied is exactly what the preview of that cutoff showed.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const cutoff = await readCutoff();
    const { candidates, noBirthDate, year } = await findCandidates(cutoff);
    return ok({ cutoff, age: PREFIX_AGE, year, candidates, noBirthDate });
  } catch (err) {
    return handleError(err);
  }
}

const bodySchema = z.object({
  day: z.number().int(),
  month: z.number().int(),
  apply: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const body = bodySchema.parse(await req.json());
    if (!validCutoff(body.day, body.month)) return badRequest('วันที่ไม่ถูกต้อง');
    const cutoff = { day: body.day, month: body.month };
    await saveCutoff(cutoff, guard.session.name ?? guard.session.sub);

    let changed = 0;
    if (body.apply) {
      changed = await applyPrefixUpdate(cutoff);
      await recordAudit({
        session: guard.session,
        action: 'update_prefix',
        targetType: 'student',
        targetLabel: 'ปรับคำนำหน้าชื่อ',
        detail: `เด็กชาย→นาย / เด็กหญิง→นางสาว ${changed} คน (อายุครบ ${PREFIX_AGE} ปีภายใน ${body.day}/${body.month})`,
        req,
      });
    }
    const { candidates, noBirthDate, year } = await findCandidates(cutoff);
    return ok({ cutoff, age: PREFIX_AGE, year, candidates, noBirthDate, changed });
  } catch (err) {
    return handleError(err);
  }
}

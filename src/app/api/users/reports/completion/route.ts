import type { NextRequest } from 'next/server';
import { requireAccess } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { buildCompletion } from '@/lib/services/staff-completion';

export const runtime = 'nodejs';

/** GET /api/users/reports/completion — who has not filled in what (ติดตามการกรอกข้อมูล). Read-only. */
export async function GET(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    return ok(await buildCompletion());
  } catch (err) {
    return handleError(err);
  }
}

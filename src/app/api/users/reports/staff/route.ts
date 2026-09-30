import type { NextRequest } from 'next/server';
import { requireAccess } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { buildStaffReport } from '@/lib/services/staff-report';

export const runtime = 'nodejs';

/**
 * GET /api/users/reports/staff — รายงานบุคลากร: counts and the names behind
 * them (ตำแหน่ง, กลุ่มสาระ, อายุงาน, อายุ, วุฒิ, ใบประกอบฯ, ลูกเสือ, ช่องที่ยังไม่กรอก).
 * Names and codes only — nothing a staff.records moderator cannot already see
 * on the teacher pages. Read-only.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    return ok(await buildStaffReport());
  } catch (err) {
    return handleError(err);
  }
}

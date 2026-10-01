import type { NextRequest } from 'next/server';
import { requireAccess } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { buildStaffReport } from '@/lib/services/staff-report';
import { buildStaffReportWorkbook } from '@/lib/services/staff-report-excel';
import { ALL_SECTION_KEYS } from '@/lib/report-sections';

export const runtime = 'nodejs';

/**
 * GET /api/users/reports/staff/export?sections=overview,positions,…&names=1
 * — รายงานบุคลากร as .xlsx, limited to the sections asked for (all when the
 * parameter is missing). Audited like every other export, since it lists names.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const asked = (sp.get('sections') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const keys = asked.length ? ALL_SECTION_KEYS.filter((k) => asked.includes(k)) : ALL_SECTION_KEYS;
    const withNames = sp.get('names') === '1';

    const report = await buildStaffReport();
    const buf = await buildStaffReportWorkbook(report, keys, withNames);
    await recordAudit({
      session: guard.session,
      action: 'export',
      targetType: 'teacher',
      detail: `ส่งออกรายงานบุคลากร (Excel) ${keys.length} หัวข้อ${withNames ? ' พร้อมรายชื่อ' : ''}`,
      req,
    });
    const day = new Date(report.asOf).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="staff-report-${day}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

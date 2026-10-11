import type { NextRequest } from 'next/server';
import { requireAccess } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { buildCompletion } from '@/lib/services/staff-completion';
import { buildCompletionWorkbook } from '@/lib/services/staff-completion-excel';

export const runtime = 'nodejs';

/**
 * GET /api/users/reports/completion/export?group=…&field=…&incomplete=1 —
 * the tracking sheet as .xlsx, narrowed the same way the page is.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const group = sp.get('group') ?? '';
    const field = sp.get('field') ?? '';
    const incomplete = sp.get('incomplete') === '1';

    const report = await buildCompletion();
    const people = report.people.filter((p) =>
      (!group || (p.subjectGroup ?? 'ไม่ระบุกลุ่มสาระ') === group) &&
      (!field || p.missing.includes(field as never) || p.officeMissing.includes(field as never)) &&
      (!incomplete || p.missing.length > 0),
    );
    const buf = await buildCompletionWorkbook(report, people);
    await recordAudit({
      session: guard.session,
      action: 'export',
      targetType: 'teacher',
      detail: `ส่งออกใบติดตามการกรอกข้อมูล ${people.length} คน`,
      req,
    });
    const day = new Date(report.asOf).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="staff-completion-${day}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

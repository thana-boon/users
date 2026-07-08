import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { buildTeacherExport } from '@/lib/excel-io';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const rows = await db.query.teachers.findMany({
      where: eq(teachers.isArchived, false),
      orderBy: (t, { asc }) => asc(t.teacherCode),
    });
    const buf = await buildTeacherExport(rows);
    await recordAudit({
      session: guard.session,
      action: 'export',
      targetType: 'teacher',
      detail: `ส่งออก ${rows.length} รายการ`,
      req,
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="teachers.xlsx"',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

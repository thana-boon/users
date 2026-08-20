import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { buildSpecialTeacherExport } from '@/lib/excel-io';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const rows = await db.query.specialTeachers.findMany({
      where: eq(specialTeachers.isArchived, false),
      orderBy: (t, { asc }) => asc(t.specialTeacherCode),
    });
    const buf = await buildSpecialTeacherExport(rows);
    await recordAudit({
      session: guard.session,
      action: 'export',
      targetType: 'special_teacher',
      detail: `ส่งออก ${rows.length} รายการ`,
      req,
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="special_teachers.xlsx"',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

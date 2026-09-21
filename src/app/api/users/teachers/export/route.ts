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
    // The three qualification lists ride along into their own sheets, ordered
    // the way the teacher arranged them so the file reads as they left it.
    const rows = await db.query.teachers.findMany({
      where: eq(teachers.isArchived, false),
      orderBy: (t, { asc }) => asc(t.teacherCode),
      with: {
        educations: { orderBy: (e, { asc }) => [asc(e.sortOrder), asc(e.id)] },
        scoutQualifications: { orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.id)] },
        trainings: { orderBy: (r, { asc }) => [asc(r.sortOrder), asc(r.id)] },
      },
    });
    const buf = await buildTeacherExport(rows);
    await recordAudit({
      session: guard.session,
      action: 'export',
      targetType: 'teacher',
      detail:
        `ส่งออก ${rows.length} รายการ` +
        ` (วุฒิการศึกษา ${count(rows, 'educations')}, ` +
        `วุฒิลูกเสือ ${count(rows, 'scoutQualifications')}, ` +
        `การอบรม ${count(rows, 'trainings')})`,
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

/** Total rows across one list, for the audit line. */
function count<K extends 'educations' | 'scoutQualifications' | 'trainings'>(
  rows: Array<Record<K, unknown[]>>,
  key: K,
): number {
  return rows.reduce((n, r) => n + r[key].length, 0);
}

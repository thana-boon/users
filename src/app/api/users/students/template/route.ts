import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { buildStudentTemplate } from '@/lib/excel-io';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const buf = await buildStudentTemplate();
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="students_template.xlsx"',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

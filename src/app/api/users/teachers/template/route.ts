import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { buildTeacherTemplate } from '@/lib/excel-io';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const buf = await buildTeacherTemplate();
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="teachers_template.xlsx"',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

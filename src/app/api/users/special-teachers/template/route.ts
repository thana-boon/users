import type { NextRequest } from 'next/server';
import { requireAccess } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { buildSpecialTeacherTemplate } from '@/lib/excel-io';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const buf = await buildSpecialTeacherTemplate();
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="special_teachers_template.xlsx"',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

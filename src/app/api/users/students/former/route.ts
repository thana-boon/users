import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { listFormerStudents } from '@/lib/services/students';

export const runtime = 'nodejs';

/**
 * GET /api/users/students/former — paged, searchable list of นักเรียนเก่า
 * (students who left: status withdrawn OR graduated). Not tied to the active
 * year, so it surfaces alumni that the year-joined registry list can't. Optional
 * `status` narrows to just withdrawn or just graduated.
 */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const statusParam = (sp.get('status') ?? '').trim();
    const status =
      statusParam === 'withdrawn' || statusParam === 'graduated' ? statusParam : undefined;
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '25') || 25));

    const { data, total } = await listFormerStudents({ q, status, page, pageSize });
    return ok({ data, total, page, pageSize });
  } catch (err) {
    return handleError(err);
  }
}

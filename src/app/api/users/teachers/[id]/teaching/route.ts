import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { fetchTeachingClasses } from '@/lib/timetable';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/users/teachers/:id/teaching — admin view of the same; see ../../../me/teaching. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    return ok({ timetable: await fetchTeachingClasses(id) });
  } catch (err) {
    return handleError(err);
  }
}

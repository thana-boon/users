import type { NextRequest } from 'next/server';
import { requireSelfTeacher } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { fetchTeachingClasses } from '@/lib/timetable';

export const runtime = 'nodejs';

/**
 * GET /api/users/me/teaching — the classes the signed-in teacher teaches this
 * term, according to the timetable service. `null` when the timetable is not
 * configured or not answering; the page then falls back to the stored
 * ชั้นที่สอน. Kept apart from GET /api/users/me so a slow timetable never holds
 * up the profile itself.
 */
export async function GET(req: NextRequest) {
  const guard = await requireSelfTeacher(req);
  if (!guard.ok) return guard.response;
  try {
    return ok({ timetable: await fetchTeachingClasses(guard.teacher.id) });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireApiScope, apiError } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { readContactsFor } from '@/lib/services/student-extras';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/students/[id]/emergency-contact — the block on its own.
 *
 * READ ONLY. This endpoint used to accept a PATCH as well: the school collects
 * เบอร์ติดต่อฉุกเฉิน through another system's form, and letting that system hand
 * the number straight back beat having somebody re-type it here. The write is
 * gone, and the school's rule is now the simpler one — an outside system may
 * change NOTHING that the office typed. The number the school calls when a
 * child is hurt is the last field that should sit under another system's
 * control, and a form that fills it in wrongly, or a key that leaks, would have
 * overwritten it with nobody noticing until the call failed.
 *
 * What replaces it: PATCH ./additional-phone, which writes เบอร์เพิ่มเติม — a
 * column no office form fills in, whose worst case is a wrong EXTRA number
 * beside the right one. That is the only write left on the public surface. The
 * `students:contact:write` scope is retired with the route; a key still
 * carrying the string gets nothing from it.
 *
 * ผู้ปกครอง/บิดา/มารดา were never writable and are not now: a guardian is a
 * record about a third person who never dealt with the integration asking.
 *
 * Archived (ถังขยะ) students are 404 here, as on every other endpoint.
 */

type Ctx = { params: Promise<{ id: string }> };

/** Resolve the id and confirm the student is real and not in the bin. */
async function resolveStudent(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { error: apiError(400, 'invalid_id', 'id ต้องเป็นตัวเลข') };
  const row = await db.query.students.findFirst({
    where: eq(students.id, id),
    columns: { id: true, studentCode: true, firstName: true, lastName: true, isArchived: true },
  });
  if (!row || row.isArchived) return { error: apiError(404, 'not_found', 'ไม่พบนักเรียนรายนี้') };
  return { student: row };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  // Same scope as `?include=contact` on the student endpoints — this route is
  // that block on its own, for a caller that wants nothing else.
  const guard = await requireApiScope(req, 'students:contact');
  if (!guard.ok) return guard.response;

  try {
    const resolved = await resolveStudent((await params).id);
    if (resolved.error) return resolved.error;
    const { student } = resolved;

    const contacts = await readContactsFor([student.id]);

    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'api_read',
      targetType: 'student',
      targetId: student.id,
      targetLabel: `public API · ${student.studentCode} ${student.firstName} ${student.lastName} · ผู้ติดต่อฉุกเฉิน`,
      detail: `GET /api/public/v1/students/${student.id}/emergency-contact`,
      req,
    });

    return ok({ data: contacts.get(student.id) ?? null });
  } catch (err) {
    return handleError(err);
  }
}

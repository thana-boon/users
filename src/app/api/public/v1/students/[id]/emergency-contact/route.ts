import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireApiScope, apiError } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import {
  emergencyContactSchema,
  readContactsFor,
  writeEmergencyContact,
} from '@/lib/services/student-extras';

export const runtime = 'nodejs';

/**
 * GET   /api/public/v1/students/[id]/emergency-contact — read the block alone.
 * PATCH /api/public/v1/students/[id]/emergency-contact — write it back.
 *
 * THE ONLY WRITE ON THE PUBLIC SURFACE. It exists because the school collects
 * เบอร์ติดต่อฉุกเฉิน through another system's form — a parent fills it in there,
 * and until now somebody re-typed it here, which is how a number that was
 * updated in March is still the old one in September. The other system can now
 * hand it straight back.
 *
 * WHAT IT MAY TOUCH, and nothing else: the emergency fields of ที่อยู่ปัจจุบัน
 * (see `emergencyContactSchema`). It cannot create or delete a student, cannot
 * change a name, a ชั้น/ห้อง, a เลขบัตร, or ที่อยู่ตามทะเบียนบ้าน, and cannot
 * rewrite a ผู้ปกครอง row — a guardian is a record about a third person, and
 * the emergency contact beside it is exactly the field that covers "our number
 * changed" without letting an outside system edit one. The schema is `.strict()`
 * so a payload naming anything else is a 400, never a quiet no-op.
 *
 * PATCH, not PUT, and every field optional: the normal call is a one-key body
 * ("this is the new เบอร์ฉุกเฉิน"), and a partial body must never blank the rest
 * of the block by omission. To clear a field, send it as null or "".
 *
 * Every write lands in the audit trail naming the key, the student and the
 * fields touched — the log answers "who changed this child's emergency number
 * and when", which is the first question when the school rings the wrong number.
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
  // Read needs only the read scope — a system that fills the form in also
  // wants to show what is currently on file before overwriting it.
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

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiScope(req, 'students:contact:write');
  if (!guard.ok) return guard.response;

  try {
    const resolved = await resolveStudent((await params).id);
    if (resolved.error) return resolved.error;
    const { student } = resolved;

    // Parsed in the public surface's error envelope rather than the admin UI's,
    // so an integration gets `{ error: { code, message } }` here as everywhere
    // else on /api/public/v1.
    const parsed = emergencyContactSchema.safeParse(await req.json());
    if (!parsed.success) {
      return apiError(
        400,
        'invalid_body',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(', '),
      );
    }

    const changed = await writeEmergencyContact(student.id, parsed.data);

    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'update',
      targetType: 'student',
      targetId: student.id,
      targetLabel: `${student.studentCode} ${student.firstName} ${student.lastName}`,
      detail: `public API เขียนผู้ติดต่อฉุกเฉิน: ${changed.join(', ')}`,
      req,
    });

    // The stored block, not the payload: numbers are normalized on the way in
    // (a trailing "-" is trimmed), so echoing the request back would tell the
    // caller their value was kept verbatim when it was not.
    const contacts = await readContactsFor([student.id]);
    return ok({ data: contacts.get(student.id) ?? null, updated: changed });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireApiScope, apiError } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { phoneField, phoneWarning } from '@/lib/phone';

export const runtime = 'nodejs';

/**
 * GET   /api/public/v1/students/[id]/additional-phone — read เบอร์เพิ่มเติม.
 * PATCH /api/public/v1/students/[id]/additional-phone — write it back.
 *
 * THE ONLY WRITE ON THE PUBLIC SURFACE, and it reaches exactly one column:
 * `students.additional_phone`. Everything else the API serves — ชื่อ, ชั้น/ห้อง,
 * เลขบัตร, ที่อยู่, ผู้ปกครอง, เบอร์ฉุกเฉิน, สุขภาพ — is read-only to an outside
 * system, with no endpoint that changes it and no scope that would let one.
 *
 * WHY THIS COLUMN AND NO OTHER. The school collects a second contact number
 * through another system's form, and until now somebody re-typed it here, which
 * is how a number updated in March is still the old one in September. The
 * obvious fix — let that system write the เบอร์ฉุกเฉิน it collected — is what
 * this replaces, because it put the number the office calls in an emergency
 * under an outside system's control. เบอร์เพิ่มเติม is a field no office form
 * fills in, added for this purpose alone, so the worst a buggy or compromised
 * integration can do here is put a wrong EXTRA number on a child. Nothing the
 * school typed can be lost. That is the whole reason the write is allowed.
 *
 * The body is `{ "additionalPhone": "0812345678" }` and `.strict()`, so a
 * payload naming any other field is a 400 rather than a quiet no-op — an
 * integration that believes it is updating a name must be told it is not.
 *
 * `null` (or "") clears the field on purpose: "this number is no longer valid"
 * is a real thing the other system learns and has to be able to tell us.
 *
 * The number is stored as digits only, like every other phone write in the
 * module (see lib/phone.ts), so the response echoes the STORED value rather
 * than the payload — a caller that sent "081-234-5678" must not be told it was
 * kept verbatim. `warning` flags a number of an odd length without refusing it,
 * the same doubt the admin editor shows a human.
 *
 * Every write lands in the audit trail naming the key, the student and the old
 * and new value — "who put this number on this child and when" is the first
 * question when it turns out to be wrong.
 *
 * Archived (ถังขยะ) students are 404 here, as on every other endpoint.
 */

type Ctx = { params: Promise<{ id: string }> };

/** Resolve the id and confirm the student is real and not in the bin. */
async function resolveStudent(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: apiError(400, 'invalid_id', 'id ต้องเป็นตัวเลข') };
  }
  const row = await db.query.students.findFirst({
    where: eq(students.id, id),
    columns: {
      id: true,
      studentCode: true,
      firstName: true,
      lastName: true,
      additionalPhone: true,
      isArchived: true,
    },
  });
  if (!row || row.isArchived) return { error: apiError(404, 'not_found', 'ไม่พบนักเรียนรายนี้') };
  return { student: row };
}

/**
 * The whole writable surface of the public API, in one object.
 *
 * `phoneField` normalizes during parse, so the route cannot forget the
 * digits-only rule. `.strict()` rejects any other key; the field is required
 * here rather than optional because a body with nothing in it has no meaning —
 * unlike a partial patch over a block of fields, there is nothing to leave alone.
 */
const bodySchema = z.object({ additionalPhone: phoneField }).strict();

export async function GET(req: NextRequest, { params }: Ctx) {
  // Read sits under `students:read` rather than its own scope: the number is
  // already in the roster row that scope returns, so gating the single-field
  // view harder would only mean a caller reads it from the other endpoint.
  const guard = await requireApiScope(req, 'students:read');
  if (!guard.ok) return guard.response;

  try {
    const resolved = await resolveStudent((await params).id);
    if (resolved.error) return resolved.error;
    const { student } = resolved;

    return ok({
      data: {
        id: student.id,
        studentCode: student.studentCode,
        additionalPhone: student.additionalPhone,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiScope(req, 'students:phone:write');
  if (!guard.ok) return guard.response;

  try {
    const resolved = await resolveStudent((await params).id);
    if (resolved.error) return resolved.error;
    const { student } = resolved;

    // Parsed in the public surface's error envelope rather than the admin UI's,
    // so an integration gets `{ error: { code, message } }` here as everywhere
    // else on /api/public/v1.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError(400, 'invalid_body', 'body ต้องเป็น JSON');
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(
        400,
        'invalid_body',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(', '),
      );
    }

    const value = parsed.data.additionalPhone ?? null;
    const before = student.additionalPhone;

    if (value !== before) {
      await db
        .update(students)
        .set({ additionalPhone: value })
        .where(eq(students.id, student.id));
    }

    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'update',
      targetType: 'student',
      targetId: student.id,
      targetLabel: `${student.studentCode} ${student.firstName} ${student.lastName}`,
      // Both values, because the question asked of this log is always "what did
      // it used to be" — the office noticed the number is wrong, not that it changed.
      detail:
        value === before
          ? `public API เขียนเบอร์เพิ่มเติม: ไม่เปลี่ยนแปลง (${before ?? '—'})`
          : `public API เขียนเบอร์เพิ่มเติม: ${before ?? '—'} → ${value ?? '—'}`,
      req,
    });

    return ok({
      // The stored value, not the payload: "081-234-5678" is saved as digits.
      data: { id: student.id, studentCode: student.studentCode, additionalPhone: value },
      changed: value !== before,
      warning: phoneWarning(value),
    });
  } catch (err) {
    return handleError(err);
  }
}

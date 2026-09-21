import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireSelf } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import {
  SELF_EDITABLE,
  describeLists,
  readTeacherProfile,
  replaceTeacherLists,
  selfPatchSchema,
} from '@/lib/services/teachers';
import {
  STUDENT_SELF_EDITABLE,
  applyStudentSelfPatch,
  readStudentProfile,
  studentSelfPatchSchema,
} from '@/lib/services/student-self';
import { selfEditClosedMessage, selfEditEnabled } from '@/lib/services/settings';

export const runtime = 'nodejs';

/**
 * GET   /api/users/me — the signed-in person's own record.
 * PATCH /api/users/me — the fields they may change about themselves.
 *
 * One route for both audiences, branching on the token's role: a teacher gets
 * their staff record and the three วุฒิ/อบรม lists, a student gets identity +
 * ข้อมูลสุขภาพ + ที่อยู่ปัจจุบัน. Which branch runs is never taken from the
 * request, and neither route takes an id — the row comes from the token, so the
 * worst any caller can do is edit themselves.
 *
 * What may be edited is SELF_EDITABLE (services/teachers.ts) and
 * STUDENT_SELF_EDITABLE (services/student-self.ts), each with its locks
 * explained. Both schemas are `.strict()`, so a payload naming a locked field is
 * a 400 — someone who finds a way to put `role` in the body is told no, not
 * quietly ignored.
 *
 * On top of the per-field policy sits the school-wide switch an admin flips at
 * /users/settings: with the window closed, GET still answers (so the page can
 * show the record and say why it is read-only) and PATCH is refused.
 */

export async function GET(req: NextRequest) {
  const guard = await requireSelf(req);
  if (!guard.ok) return guard.response;
  try {
    const { audience, person } = guard;
    const windowOpen = await selfEditEnabled(audience);
    // Editing is off for anyone who has left, whatever the school-wide switch
    // says — see SelfPerson.active.
    const canEdit = windowOpen && person.active;

    const profile =
      audience === 'teacher'
        ? await readTeacherProfile(person.id)
        : await readStudentProfile(person.id);
    if (!profile) return notFound();

    return ok({
      ...profile,
      audience,
      // Which fields this page may enable, straight from the policy the PATCH
      // below enforces — so a locked field can never look editable.
      editableFields: audience === 'teacher' ? SELF_EDITABLE : STUDENT_SELF_EDITABLE,
      canEdit,
      // Told apart on purpose: "the school closed the window" and "you have
      // left" are different facts and the page says the right one.
      closedReason: canEdit
        ? null
        : !person.active
          ? 'บัญชีนี้ไม่ได้อยู่ในสถานะปัจจุบันแล้ว จึงดูข้อมูลได้อย่างเดียว'
          : selfEditClosedMessage(audience),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSelf(req);
  if (!guard.ok) return guard.response;
  try {
    const { audience, person } = guard;
    if (!person.active) {
      return Response.json(
        { error: 'บัญชีนี้ไม่ได้อยู่ในสถานะปัจจุบันแล้ว จึงแก้ไขข้อมูลไม่ได้' },
        { status: 403 },
      );
    }
    if (!(await selfEditEnabled(audience))) {
      return Response.json({ error: selfEditClosedMessage(audience) }, { status: 403 });
    }

    const label = `${person.code} ${person.firstName} ${person.lastName}`;
    const changed =
      audience === 'teacher'
        ? await patchTeacher(person.id, await req.json())
        : await patchStudent(person.id, await req.json());

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: audience,
      targetId: person.id,
      targetLabel: label,
      // Marked as a self-edit, because in the log it is the interesting part:
      // this is the one kind of row that changes without an admin.
      detail: `แก้ไขข้อมูลตนเอง: ${changed.join(', ')}`,
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

async function patchTeacher(id: number, raw: unknown): Promise<string[]> {
  const body = selfPatchSchema.parse(raw);
  const { educations, scoutQualifications, trainings, ...scalars } = body;

  if (Object.keys(scalars).length) {
    await db.update(teachers).set(scalars).where(eq(teachers.id, id));
  }
  const lists = { educations, scoutQualifications, trainings };
  await replaceTeacherLists(id, lists);
  return [...Object.keys(scalars), ...describeLists(lists)];
}

async function patchStudent(id: number, raw: unknown): Promise<string[]> {
  return applyStudentSelfPatch(id, studentSelfPatchSchema.parse(raw));
}

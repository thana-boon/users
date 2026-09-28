import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireAccess } from '@/lib/rbac';
import { ok, notFound, forbidden, handleError } from '@/lib/http';
import { isPrivilegedTeacher } from '@/lib/services/grants';
import { encrypt } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';
import {
  describeLists,
  profileColumns,
  readTeacherProfile,
  replaceTeacherLists,
  teacherListsSchema,
  teacherProfileFieldsSchema,
} from '@/lib/services/teachers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const profile = await readTeacherProfile(id);
    if (!profile) return notFound();
    return ok(profile);
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = teacherListsSchema.merge(teacherProfileFieldsSchema).extend({
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().nullable().optional(),
  subjectGroup: z.string().nullable().optional(),
  gradeTaught: z.string().nullable().optional(),
  // No `role`: roles change only on /users/permissions, which also keeps the
  // moderator grants and the last-admin rule straight. A `role` sent here (the
  // edit form used to) is stripped by zod and ignored.
  password: z.string().trim().min(1).optional(), // set new password (re-encrypted, trimmed)
  citizenId: z.string().optional(), // set new เลขบัตร ปชช. (blank = keep, per student convention)
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = patchSchema.parse(await req.json());
    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true, role: true },
    });
    if (!t) return notFound();

    // A moderator (staff.records) edits the record, not the account: setting a
    // password would let them sign in as whoever they chose, an admin included.
    if (!guard.isAdmin && body.password) return forbidden('เปลี่ยนรหัสผ่านครูได้เฉพาะผู้ดูแลระบบ');
    if (!guard.isAdmin && body.citizenId?.trim() && !guard.caps?.includes('staff.sensitive')) {
      return forbidden('แก้ไขเลขบัตรประชาชนต้องมีสิทธิ์ข้อมูลลับบุคลากร');
    }

    const { password, citizenId, educations, scoutQualifications, trainings, ...rest } = body;
    // profileColumns fans the nested ที่อยู่ out into its addr_* columns.
    const set: Record<string, unknown> = profileColumns(rest);
    if (password) set.passwordEncrypted = encrypt(password);
    // Only rewrite the encrypted citizen id when a non-empty value is supplied.
    if (citizenId && citizenId.trim()) set.citizenIdEncrypted = encrypt(citizenId.trim());

    // A PATCH carrying only lists must not run an empty `set` — Drizzle refuses
    // an update with no columns, and the lists are the change in that case.
    if (Object.keys(set).length) {
      await db.update(teachers).set(set).where(eq(teachers.id, id));
    }
    const lists = { educations, scoutQualifications, trainings };
    await replaceTeacherLists(id, lists);

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail: `แก้ไข: ${[
        ...Object.keys(rest),
        ...(password ? ['รหัสผ่าน'] : []),
        ...(citizenId?.trim() ? ['เลขบัตร ปชช.'] : []),
        ...describeLists(lists),
      ].join(', ')}`,
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true },
    });
    if (!t) return notFound();
    if (!guard.isAdmin && (await isPrivilegedTeacher(id))) {
      return forbidden('บัญชีนี้มีสิทธิ์ในระบบ — ให้ผู้ดูแลระบบเป็นผู้ย้ายลงถังขยะ');
    }
    await db.update(teachers).set({ isArchived: true }).where(eq(teachers.id, id));
    await recordAudit({
      session: guard.session,
      action: 'archive',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      req,
    });
    return ok({ ok: true, archived: true });
  } catch (err) {
    return handleError(err);
  }
}

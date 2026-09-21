import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { encrypt } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';
import {
  describeLists,
  readTeacherProfile,
  replaceTeacherLists,
  teacherListsSchema,
} from '@/lib/services/teachers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
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

const patchSchema = teacherListsSchema.extend({
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  lineId: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(), // raw Thai dd/mm/BBBB
  subjectGroup: z.string().nullable().optional(),
  gradeTaught: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  religion: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  ethnicity: z.string().nullable().optional(),
  role: z.enum(['teacher', 'teacher-admin']).optional(),
  password: z.string().trim().min(1).optional(), // set new password (re-encrypted, trimmed)
  citizenId: z.string().optional(), // set new เลขบัตร ปชช. (blank = keep, per student convention)
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = patchSchema.parse(await req.json());
    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true, role: true },
    });
    if (!t) return notFound();

    const { password, citizenId, educations, scoutQualifications, trainings, ...rest } = body;
    const set: Record<string, unknown> = { ...rest };
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

    const changedRole = body.role && body.role !== t.role;
    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail: changedRole
        ? `เปลี่ยน role: ${t.role} -> ${body.role}`
        : `แก้ไข: ${[
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
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true },
    });
    if (!t) return notFound();
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

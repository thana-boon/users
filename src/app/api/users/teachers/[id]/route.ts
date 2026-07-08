import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { encrypt, maskCitizenId, tryDecrypt } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const t = await db.query.teachers.findFirst({ where: eq(teachers.id, id) });
    if (!t) return notFound();
    const { passwordEncrypted, citizenIdEncrypted, ...core } = t;
    return ok({
      ...core,
      citizenIdMasked: maskCitizenId(tryDecrypt(citizenIdEncrypted)),
      hasCitizenId: !!citizenIdEncrypted,
      hasPassword: !!passwordEncrypted,
    });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().nullable().optional(),
  subjectGroup: z.string().nullable().optional(),
  gradeTaught: z.string().nullable().optional(),
  role: z.enum(['teacher', 'teacher-admin']).optional(),
  password: z.string().min(1).optional(), // set new password (re-encrypted)
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

    const { password, ...rest } = body;
    const set: Record<string, unknown> = { ...rest };
    if (password) set.passwordEncrypted = encrypt(password);

    await db.update(teachers).set(set).where(eq(teachers.id, id));

    const changedRole = body.role && body.role !== t.role;
    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail: changedRole
        ? `เปลี่ยน role: ${t.role} -> ${body.role}`
        : `แก้ไข: ${Object.keys(body).join(', ')}`,
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

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET/PATCH/DELETE one อาจารย์พิเศษ. DELETE = ย้ายไปถังขยะ (soft), as everywhere else. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    // Columns are listed rather than taking the whole row: `photo_base64` is a
    // megabyte-scale string and belongs in /[id]/photo, not in a JSON detail
    // response — the client only needs to know whether one exists.
    const row = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.id, id),
      columns: { photoBase64: false, photoMime: false },
      extras: (t, { sql }) => ({
        hasPhoto: sql<boolean>`${t.photoBase64} is not null`.as('has_photo'),
      }),
    });
    if (!row) return notFound();
    return ok(row);
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  specialTeacherCode: z.string().min(1).optional(),
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  subjectGroup: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = patchSchema.parse(await req.json());
    const row = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.id, id),
      columns: { id: true, specialTeacherCode: true, firstName: true, lastName: true },
    });
    if (!row) return notFound();

    const set: Record<string, unknown> = { ...body };
    if (body.specialTeacherCode !== undefined) {
      const code = body.specialTeacherCode.trim();
      if (!code) return badRequest('กรุณากรอกรหัสอาจารย์พิเศษ');
      if (code !== row.specialTeacherCode) {
        const dup = await db.query.specialTeachers.findFirst({
          where: eq(specialTeachers.specialTeacherCode, code),
          columns: { id: true },
        });
        if (dup) return badRequest('รหัสอาจารย์พิเศษนี้มีในระบบแล้ว');
      }
      set.specialTeacherCode = code;
    }
    // Blank เลือกกลุ่มสาระ/เบอร์โทร means "ไม่ระบุ", not the empty string — the
    // filter dropdown groups on the column and '' would show up as its own group.
    if (body.subjectGroup !== undefined) set.subjectGroup = body.subjectGroup?.trim() || null;
    if (body.phone !== undefined) set.phone = body.phone?.trim() || null;

    await db.update(specialTeachers).set(set).where(eq(specialTeachers.id, id));

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'special_teacher',
      targetId: id,
      targetLabel: `${row.specialTeacherCode} ${row.firstName} ${row.lastName}`,
      detail: `แก้ไข: ${Object.keys(body).join(', ')}`,
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
    const row = await db.query.specialTeachers.findFirst({
      where: eq(specialTeachers.id, id),
      columns: { id: true, specialTeacherCode: true, firstName: true, lastName: true },
    });
    if (!row) return notFound();

    await db.update(specialTeachers).set({ isArchived: true }).where(eq(specialTeachers.id, id));
    await recordAudit({
      session: guard.session,
      action: 'archive',
      targetType: 'special_teacher',
      targetId: id,
      targetLabel: `${row.specialTeacherCode} ${row.firstName} ${row.lastName}`,
      req,
    });
    return ok({ ok: true, archived: true });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { maskCitizenId, tryDecrypt } from '@/lib/crypto';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET    /api/users/students/[id]  - full record. Sensitive fields are MASKED
 *                                    (citizen ids), passwords are never sent,
 *                                    income is flagged encrypted. Use reveal
 *                                    endpoints (audited) to see real values.
 * PATCH  /api/users/students/[id]  - update identity fields.
 * DELETE /api/users/students/[id]  - SOFT delete (is_archived) to avoid
 *                                    orphaning downstream refs (e.g. ScoreBridge).
 */

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      with: {
        enrollments: { with: { academicYear: true } },
        addresses: true,
        guardians: true,
        previousSchool: true,
        health: true,
      },
    });
    if (!s) return notFound();

    // Shape: strip ciphertext, expose masked/flags only.
    const { passwordEncrypted, citizenIdEncrypted, ...core } = s;
    const guardiansSafe = s.guardians.map((g) => {
      const { citizenIdEncrypted: gc, incomeMonthlyEncrypted, incomeYearlyEncrypted, ...rest } =
        g;
      return {
        ...rest,
        citizenIdMasked: maskCitizenId(tryDecrypt(gc)),
        hasCitizenId: !!gc,
        hasIncome: !!(incomeMonthlyEncrypted || incomeYearlyEncrypted),
      };
    });

    return ok({
      ...core,
      citizenIdMasked: maskCitizenId(tryDecrypt(citizenIdEncrypted)),
      hasCitizenId: !!citizenIdEncrypted,
      hasPassword: !!passwordEncrypted,
      guardians: guardiansSafe,
    });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  prefix: z.string().nullable().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  nickname: z.string().nullable().optional(),
  firstNameEn: z.string().nullable().optional(),
  lastNameEn: z.string().nullable().optional(),
  nicknameEn: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  religion: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  ethnicity: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = patchSchema.parse(await req.json());
    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!s) return notFound();

    await db.update(students).set(body).where(eq(students.id, id));
    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'student',
      targetId: id,
      targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
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
    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!s) return notFound();

    await db.update(students).set({ isArchived: true }).where(eq(students.id, id));
    await recordAudit({
      session: guard.session,
      action: 'archive',
      targetType: 'student',
      targetId: id,
      targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
      req,
    });
    return ok({ ok: true, archived: true });
  } catch (err) {
    return handleError(err);
  }
}

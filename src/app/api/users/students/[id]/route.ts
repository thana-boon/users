import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { maskCitizenId, tryDecrypt } from '@/lib/crypto';
import { updateStudentAggregate } from '@/lib/services/students';

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

    // Shape: strip ciphertext + photo blob, expose masked/flags only.
    const { passwordEncrypted, citizenIdEncrypted, photoBase64, ...core } = s;
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
      hasPhoto: !!photoBase64,
      guardians: guardiansSafe,
    });
  } catch (err) {
    return handleError(err);
  }
}

const nstr = z.string().nullable().optional();
const recStr = z.record(z.string(), z.string().nullable().optional());

const patchSchema = z.object({
  prefix: nstr,
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  nickname: nstr,
  firstNameEn: nstr,
  lastNameEn: nstr,
  nicknameEn: nstr,
  gender: nstr,
  birthDate: nstr,
  religion: nstr,
  nationality: nstr,
  ethnicity: nstr,
  phone: nstr,
  email: nstr,
  admissionDate: nstr,
  citizenId: nstr,
  password: nstr,
  enrollment: z
    .object({
      id: z.number().optional(),
      gradeLevel: nstr,
      classroom: nstr,
      classNumber: nstr,
    })
    .optional(),
  health: recStr.optional(),
  previousSchool: recStr.optional(),
  addresses: z.array(recStr.and(z.object({ addressType: z.string() }))).optional(),
  guardians: z.array(recStr.and(z.object({ guardianType: z.string() }))).optional(),
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

    await updateStudentAggregate(id, body);
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

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students, guardians } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { decrypt } from '@/lib/crypto';
import { recordAudit, type AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/users/students/[id]/reveal   body: { field, guardianId? }
 * Decrypt one sensitive field for a student (or a guardian's field). ONLY
 * teacher-admin (RBAC). Every reveal is written to the audit log: who, when,
 * whose value, which field.
 */

const schema = z.object({
  field: z.enum(['password', 'citizen_id', 'income']),
  guardianId: z.number().optional(),
});

const ACTION: Record<string, AuditAction> = {
  password: 'reveal_password',
  citizen_id: 'reveal_citizen_id',
  income: 'reveal_income',
};

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const { field, guardianId } = schema.parse(await req.json());

    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: {
        id: true,
        studentCode: true,
        firstName: true,
        lastName: true,
        passwordEncrypted: true,
        citizenIdEncrypted: true,
      },
    });
    if (!s) return notFound();

    let value: string | null = null;

    if (guardianId) {
      const gd = await db.query.guardians.findFirst({
        where: eq(guardians.id, guardianId),
      });
      if (!gd || gd.studentId !== id) return notFound('ไม่พบผู้ปกครอง');
      if (field === 'citizen_id') value = decrypt(gd.citizenIdEncrypted);
      else if (field === 'income')
        value = JSON.stringify({
          monthly: decrypt(gd.incomeMonthlyEncrypted),
          yearly: decrypt(gd.incomeYearlyEncrypted),
        });
      else return badRequest('ผู้ปกครองไม่มีรหัสผ่าน');
    } else {
      if (field === 'password') value = decrypt(s.passwordEncrypted);
      else if (field === 'citizen_id') value = decrypt(s.citizenIdEncrypted);
      else return badRequest('นักเรียนไม่มีข้อมูลรายได้');
    }

    await recordAudit({
      session: guard.session,
      action: ACTION[field],
      targetType: 'student',
      targetId: id,
      targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
      detail: guardianId ? `guardian#${guardianId}` : field,
      req,
    });

    return ok({ field, value });
  } catch (err) {
    return handleError(err);
  }
}

import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { decrypt } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ field: z.enum(['password', 'citizen_id']) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const { field } = schema.parse(await req.json());
    const t = await db.query.teachers.findFirst({ where: eq(teachers.id, id) });
    if (!t) return notFound();

    const value =
      field === 'password' ? decrypt(t.passwordEncrypted) : decrypt(t.citizenIdEncrypted);
    if (value === null && field === 'citizen_id')
      return badRequest('ครูคนนี้ไม่มีเลขบัตรประชาชนในระบบ');

    await recordAudit({
      session: guard.session,
      action: field === 'password' ? 'reveal_password' : 'reveal_citizen_id',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      req,
    });
    return ok({ field, value });
  } catch (err) {
    return handleError(err);
  }
}

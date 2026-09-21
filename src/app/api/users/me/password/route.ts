import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students, teachers } from '@/db/schema';
import { requireSelf } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { decrypt, encrypt, passwordMatches } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/users/me/password — a teacher or student changes their OWN password.
 *
 * Separate from PATCH /api/users/me, and in neither allow-list, because this is
 * not a field edit: it takes a proof. `currentPassword` must match before the
 * new one is written, so a session left open on a staffroom machine cannot be
 * turned into a permanent takeover of the account by whoever sits down next.
 *
 * Deliberately NOT governed by the school-wide self-edit switch. That switch is
 * about who may revise the school's records; being able to change your own
 * password is a security control, and closing the records window must not leave
 * someone stuck with a password they think has leaked.
 *
 * An admin setting someone else's password (the detail pages) needs no such
 * proof — that is the whole point of an admin reset, and it is audited against
 * the admin who did it.
 *
 * Note the storage: passwords in this module are reversibly encrypted, not
 * hashed (admins can reveal them — see the reveal routes), so "change my
 * password" is genuinely a re-encrypt. That is the module's existing design;
 * this route does not widen it.
 */

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  // Trimmed on the way in, like every other write path, so nothing is stored
  // with edge whitespace that the login form would then have to tolerate.
  newPassword: z.string().trim().min(6, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร'),
});

export async function POST(req: NextRequest) {
  const guard = await requireSelf(req);
  if (!guard.ok) return guard.response;
  try {
    const { audience, person } = guard;
    const body = bodySchema.parse(await req.json());
    const label = `${person.code} ${person.firstName} ${person.lastName}`;

    const stored = await readStoredPassword(audience, person.id);

    // No password on the account at all: there is nothing to prove, and letting
    // the holder of a valid session set one would be a way to take over an
    // account that an admin has deliberately left without a login. Send them to
    // the office instead.
    if (stored === null) {
      return badRequest('บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ');
    }

    if (!passwordMatches(stored, body.currentPassword)) {
      // Audited: a run of these on one account is worth being able to see.
      await recordAudit({
        session: guard.session,
        action: 'update',
        targetType: audience,
        targetId: person.id,
        targetLabel: label,
        detail: 'เปลี่ยนรหัสผ่านตนเองไม่สำเร็จ (รหัสผ่านเดิมไม่ถูกต้อง)',
        req,
      });
      return badRequest('รหัสผ่านเดิมไม่ถูกต้อง');
    }

    if (passwordMatches(stored, body.newPassword)) {
      return badRequest('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    }

    const passwordEncrypted = encrypt(body.newPassword);
    if (audience === 'teacher') {
      await db.update(teachers).set({ passwordEncrypted }).where(eq(teachers.id, person.id));
    } else {
      await db.update(students).set({ passwordEncrypted }).where(eq(students.id, person.id));
    }

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: audience,
      targetId: person.id,
      targetLabel: label,
      detail: 'เปลี่ยนรหัสผ่านตนเอง',
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

/** The stored plaintext, or null when there is no password or it will not decrypt. */
async function readStoredPassword(
  audience: 'teacher' | 'student',
  id: number,
): Promise<string | null> {
  if (audience === 'teacher') {
    const row = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { passwordEncrypted: true },
    });
    return row?.passwordEncrypted ? decrypt(row.passwordEncrypted) : null;
  }
  const row = await db.query.students.findFirst({
    where: eq(students.id, id),
    columns: { passwordEncrypted: true },
  });
  return row?.passwordEncrypted ? decrypt(row.passwordEncrypted) : null;
}

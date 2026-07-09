import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { db } from '@/db';
import { students } from '@/db/schema';
import { signSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/jwt';
import { decrypt } from '@/lib/crypto';
import { badRequest, handleError } from '@/lib/http';
import { checkLockout, registerFailure, clearFailures } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * Public-facing student login. NOT behind the module RBAC - students never
 * touch the Records module; this only mints a JWT for the wider platform.
 *
 * identifier = student_code OR email (email is generated as
 * <student_code>@<STUDENT_EMAIL_DOMAIN>). Password is checked by decrypting the
 * stored ciphertext and comparing. Rate-limited + lockout to blunt brute force.
 */

const bodySchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const INVALID = 'รหัส/อีเมล หรือรหัสผ่านไม่ถูกต้อง';

export async function POST(req: NextRequest) {
  try {
    const { identifier, password } = bodySchema.parse(await req.json());
    const id = identifier.trim();

    const lock = checkLockout(`student:${id.toLowerCase()}`);
    if (!lock.allowed) {
      return NextResponse.json(
        { error: `พยายามเข้าสู่ระบบบ่อยเกินไป ลองใหม่ใน ${lock.retryAfterSec} วินาที` },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSec) } },
      );
    }

    const row = await db.query.students.findFirst({
      where: or(eq(students.studentCode, id), eq(students.email, id.toLowerCase())),
    });

    // Uniform failure path (don't leak which part was wrong).
    let valid = false;
    if (row && !row.isArchived && row.passwordEncrypted) {
      try {
        valid = decrypt(row.passwordEncrypted) === password;
      } catch {
        valid = false;
      }
    }

    if (!row || !valid) {
      registerFailure(`student:${id.toLowerCase()}`);
      return badRequest(INVALID);
    }

    clearFailures(`student:${id.toLowerCase()}`);
    // Students get a valid platform token but no `users:*` permission, so this
    // admin-only module rejects them (parity with the portal contract).
    const token = await signSession({
      sub: row.studentCode,
      role: 'student',
      name: `${row.firstName} ${row.lastName}`.trim(),
      code: row.studentCode,
      permissions: [],
    });

    await recordAudit({
      session: { sub: String(row.id), role: 'student' } as never,
      action: 'login',
      targetType: 'auth',
      targetId: row.id,
      targetLabel: row.studentCode,
      req,
    });

    const res = NextResponse.json({
      token,
      user: { id: row.id, role: 'student', studentCode: row.studentCode },
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(60 * 60 * 8));
    return res;
  } catch (err) {
    return handleError(err);
  }
}

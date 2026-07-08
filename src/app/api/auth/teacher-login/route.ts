import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { signSession, SESSION_COOKIE } from '@/lib/jwt';
import { decrypt } from '@/lib/crypto';
import { badRequest, handleError } from '@/lib/http';
import { checkLockout, registerFailure, clearFailures } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * Public-facing teacher login. Single identifier: teacher_code (e.g. T00005) -
 * no email fallback (teachers remember their code). The issued token carries
 * the teacher's real role (`teacher` or `teacher-admin`). A plain `teacher`
 * token is valid platform-wide but is rejected by this module's RBAC.
 */

const bodySchema = z.object({
  teacher_code: z.string().min(1),
  password: z.string().min(1),
});

const INVALID = 'รหัสครู หรือรหัสผ่านไม่ถูกต้อง';

export async function POST(req: NextRequest) {
  try {
    const body = bodySchema.parse(await req.json());
    const code = body.teacher_code.trim();

    const lock = checkLockout(`teacher:${code.toLowerCase()}`);
    if (!lock.allowed) {
      return NextResponse.json(
        { error: `พยายามเข้าสู่ระบบบ่อยเกินไป ลองใหม่ใน ${lock.retryAfterSec} วินาที` },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSec) } },
      );
    }

    const row = await db.query.teachers.findFirst({
      where: eq(teachers.teacherCode, code),
    });

    let valid = false;
    if (row && !row.isArchived && row.passwordEncrypted) {
      try {
        valid = decrypt(row.passwordEncrypted) === body.password;
      } catch {
        valid = false;
      }
    }

    if (!row || !valid) {
      registerFailure(`teacher:${code.toLowerCase()}`);
      return badRequest(INVALID);
    }

    clearFailures(`teacher:${code.toLowerCase()}`);
    const token = await signSession({
      sub: String(row.id),
      role: row.role, // teacher | teacher-admin, straight from the record
      name: `${row.firstName} ${row.lastName}`.trim(),
      code: row.teacherCode,
    });

    await recordAudit({
      session: { sub: String(row.id), role: row.role } as never,
      action: 'login',
      targetType: 'auth',
      targetId: row.id,
      targetLabel: row.teacherCode,
      req,
    });

    const res = NextResponse.json({
      token,
      user: {
        id: row.id,
        role: row.role,
        teacherCode: row.teacherCode,
        name: `${row.firstName} ${row.lastName}`.trim(),
      },
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}

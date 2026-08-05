import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { issueSession, USERS_READ, USERS_WRITE } from '@/lib/jwt';
import { decrypt, safeStrEqual } from '@/lib/crypto';
import { badRequest, handleError } from '@/lib/http';
import {
  checkLockout,
  registerFailure,
  clearFailures,
  loginIpGate,
  loginLimits,
} from '@/lib/rate-limit';
import { clientIp } from '@/lib/ip';
import { recordAudit, recordFailedLogin } from '@/lib/audit';
import { corsPreflight, withCors } from '@/lib/cors';

export const runtime = 'nodejs';

/**
 * Public-facing teacher login. Single identifier: teacher_code (e.g. T00005) -
 * no email fallback (teachers remember their code). A DB `teacher-admin` is
 * issued a session carrying `users:read`/`users:write`; a plain `teacher` gets a
 * valid session but is rejected by this module's RBAC.
 *
 * A successful login sets the platform session cookies, `sso_session` among them
 * (see lib/jwt.ts) — which is what makes this the SSO sign-in for every other
 * SchoolOS service, not just for this module.
 */

const bodySchema = z.object({
  teacher_code: z.string().min(1),
  password: z.string().min(1),
});

const INVALID = 'รหัสครู หรือรหัสผ่านไม่ถูกต้อง';

async function handler(req: NextRequest) {
  try {
    // Per-IP gate FIRST — blunts password-spraying across many usernames, which
    // the per-username lockout below cannot see.
    //
    // Only FAILED attempts are charged to it (see the failure branch); this
    // check does not consume. The budget used to be spent by every request,
    // successes included, and behind NAT that is the same as no budget at all:
    // the site reaches us as one address, so a class signing in together spent
    // the whole school's quota and everyone after them was told — by a portal
    // that renders any non-200 the same way — that their password was wrong.
    // See loginIpGate() for the full reasoning.
    const limits = loginLimits();
    const gate = loginIpGate(clientIp(req) ?? 'unknown', limits);
    const ipGate = gate.check();
    if (!ipGate.allowed) {
      return NextResponse.json(
        { error: `เข้าสู่ระบบผิดพลาดบ่อยเกินไป ลองใหม่ใน ${ipGate.retryAfterSec} วินาที` },
        { status: 429, headers: { 'Retry-After': String(ipGate.retryAfterSec) } },
      );
    }

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
        const stored = decrypt(row.passwordEncrypted);
        valid = stored !== null && safeStrEqual(stored, body.password);
      } catch {
        valid = false;
      }
    }

    if (!row || !valid) {
      // Charge the IP budget here and only here, then leave a row saying what
      // actually happened — the reply itself stays uniform on purpose.
      const exhausted = gate.charge(Boolean(row));
      const locked = registerFailure(
        `teacher:${code.toLowerCase()}`,
        limits.lockMaxFails,
        limits.lockWindowMs,
        limits.lockMs,
      );
      await recordFailedLogin({
        req,
        audience: 'teacher',
        identifier: code,
        targetId: row?.id ?? null,
        reason: failureReason(row),
        locked,
        ipExhausted: exhausted,
      });
      return badRequest(INVALID);
    }

    clearFailures(`teacher:${code.toLowerCase()}`);
    // Session role is always `teacher`; a DB `teacher-admin` additionally carries
    // the `users:*` permissions this module's RBAC requires.
    const isAdmin = row.role === 'teacher-admin';
    const session = await issueSession({
      sub: row.teacherCode,
      role: 'teacher',
      name: `${row.firstName} ${row.lastName}`.trim(),
      code: row.teacherCode,
      permissions: isAdmin ? [USERS_READ, USERS_WRITE] : [],
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
      token: session.token,
      user: {
        id: row.id,
        role: row.role,
        teacherCode: row.teacherCode,
        name: `${row.firstName} ${row.lastName}`.trim(),
      },
    });
    // Both the httpOnly token cookie and the readable expiry cookie the
    // idle-timeout countdown reads (see SESSION_EXP_COOKIE).
    session.apply(res.cookies);
    return res;
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Why the attempt failed — for the audit row ONLY. The caller is always told
 * the same thing (INVALID), so the endpoint still cannot be used to work out
 * which teacher codes exist.
 */
function failureReason(row: typeof teachers.$inferSelect | undefined): string {
  if (!row) return 'ไม่พบรหัสครูนี้';
  if (row.isArchived) return 'บัญชีถูกเก็บถาวรแล้ว';
  if (!row.passwordEncrypted) return 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน';
  return 'รหัสผ่านไม่ถูกต้อง';
}

// Wrapped so the 400/429 replies carry the CORS headers too — otherwise a
// cross-origin caller gets an opaque failure instead of the reason.
export const POST = withCors(handler);
export const OPTIONS = corsPreflight;

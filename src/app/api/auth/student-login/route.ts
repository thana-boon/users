import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { db } from '@/db';
import { students } from '@/db/schema';
import { issueSession } from '@/lib/jwt';
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

async function handler(req: NextRequest) {
  try {
    // Per-IP gate FIRST — blunts password-spraying across many identifiers,
    // which the per-identifier lockout below cannot see. Shares its bucket with
    // the teacher route on purpose: a sprayer working both audiences from one
    // address is one attacker, not two.
    //
    // Only FAILED attempts are charged to it (see the failure branch); this
    // check does not consume. This route is where that mattered most — the
    // portal tries teacher-login first and falls back to here, so every student
    // signing in cost the old shared budget two units, halving it to ~15 student
    // logins per 5 minutes for an entire NATted site. See loginIpGate().
    const limits = loginLimits();
    const gate = loginIpGate(clientIp(req) ?? 'unknown', limits);
    const ipGate = gate.check();
    if (!ipGate.allowed) {
      return NextResponse.json(
        { error: `เข้าสู่ระบบผิดพลาดบ่อยเกินไป ลองใหม่ใน ${ipGate.retryAfterSec} วินาที` },
        { status: 429, headers: { 'Retry-After': String(ipGate.retryAfterSec) } },
      );
    }

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
        const stored = decrypt(row.passwordEncrypted);
        valid = stored !== null && safeStrEqual(stored, password);
      } catch {
        valid = false;
      }
    }

    if (!row || !valid) {
      // Charge the IP budget here and only here, then leave a row saying what
      // actually happened — the reply itself stays uniform on purpose.
      const exhausted = gate.charge(Boolean(row));
      const locked = registerFailure(
        `student:${id.toLowerCase()}`,
        limits.lockMaxFails,
        limits.lockWindowMs,
        limits.lockMs,
      );
      await recordFailedLogin({
        req,
        audience: 'student',
        identifier: id,
        targetId: row?.id ?? null,
        reason: failureReason(row),
        locked,
        ipExhausted: exhausted,
      });
      return badRequest(INVALID);
    }

    clearFailures(`student:${id.toLowerCase()}`);
    // Students get a valid platform token but no `users:*` permission, so this
    // admin-only module rejects them (parity with the portal contract).
    const session = await issueSession({
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
      token: session.token,
      user: { id: row.id, role: 'student', studentCode: row.studentCode },
    });
    session.apply(res.cookies);
    return res;
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Why the attempt failed — for the audit row ONLY. The caller is always told
 * the same thing (INVALID), so the endpoint still cannot be used to work out
 * which student codes exist.
 */
function failureReason(row: typeof students.$inferSelect | undefined): string {
  if (!row) return 'ไม่พบรหัส/อีเมลนี้';
  if (row.isArchived) return 'บัญชีถูกเก็บถาวรแล้ว';
  if (!row.passwordEncrypted) return 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน';
  return 'รหัสผ่านไม่ถูกต้อง';
}

// Wrapped so the 400/429 replies carry the CORS headers too — otherwise a
// cross-origin caller gets an opaque failure instead of the reason.
export const POST = withCors(handler);
export const OPTIONS = corsPreflight;

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students, teachers } from '@/db/schema';
import { requireApiScope } from '@/lib/apiauth';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { decrypt } from '@/lib/crypto';
import { checkLockout, registerFailure, clearFailures } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * POST /api/public/v1/auth/verify — credential check for other SchoolOS systems.
 *
 * This is a *verification* endpoint, not a token issuer: it answers "are these
 * credentials correct, and who is this?" and the calling system mints its own
 * session. Chosen over handing out a SchoolOS JWT because that would require
 * sharing `JWT_SECRET` (HS256) with every consumer — anyone holding it could
 * forge a token for any user, including an admin.
 *
 * Auth: the CALLER needs an API key with `auth:students` / `auth:teachers`
 * (whichever audience it is asking about). Split per audience so a system that
 * only serves students cannot test passwords against staff accounts.
 *
 * Body: { role: 'student'|'teacher', username, password }
 *   student username = student_code OR email; teacher username = teacher_code.
 *
 * Never returns the password, the citizen id, or any token.
 */

const bodySchema = z.object({
  role: z.enum(['student', 'teacher']),
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Uniform failure. Deliberately identical for "no such user" and "wrong
 * password" so the endpoint cannot be used to enumerate who exists.
 */
function invalid(): NextResponse {
  return NextResponse.json(
    { valid: false, error: { code: 'invalid_credentials', message: 'รหัสผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง' } },
    { status: 401 },
  );
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return handleError(err);
  }

  // The audience being asked about decides which scope is required, so the
  // body must be parsed before the guard runs.
  const guard = await requireApiScope(
    req,
    body.role === 'student' ? 'auth:students' : 'auth:teachers',
  );
  if (!guard.ok) return guard.response;

  try {
    const username = body.username.trim();
    // Lockout is keyed by the identifier being tested (not the caller), so a
    // brute-force against one account is throttled no matter which system —
    // or how many keys — it comes through. Namespaced apart from the first-party
    // login buckets in /api/auth/* so one cannot lock a user out of the other.
    const lockKey = `apiverify:${body.role}:${username.toLowerCase()}`;
    const lock = checkLockout(lockKey);
    if (!lock.allowed) {
      return NextResponse.json(
        {
          valid: false,
          error: {
            code: 'too_many_attempts',
            message: `พยายามตรวจสอบบ่อยเกินไป ลองใหม่ใน ${lock.retryAfterSec} วินาที`,
          },
        },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSec) } },
      );
    }

    const found =
      body.role === 'student'
        ? await verifyStudent(username, body.password)
        : await verifyTeacher(username, body.password);

    if (!found) {
      registerFailure(lockKey);
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: 'login',
        targetType: 'auth',
        targetLabel: `${username} · ล้มเหลว`,
        detail: `POST /api/public/v1/auth/verify (${body.role})`,
        req,
      });
      return invalid();
    }

    clearFailures(lockKey);
    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'login',
      targetType: 'auth',
      targetId: found.id,
      targetLabel: `${found.code} · สำเร็จ`,
      detail: `POST /api/public/v1/auth/verify (${body.role})`,
      req,
    });

    return NextResponse.json({ valid: true, user: found });
  } catch (err) {
    return handleError(err);
  }
}

interface VerifiedUser {
  id: number;
  code: string;
  name: string;
  role: string;
  /**
   * Whether the person is currently on the roll / employed. This endpoint
   * authenticates them either way and lets the CALLING system decide — a
   * graduated student may still legitimately need to sign in for documents,
   * while a resigned teacher usually should not. Consumers must check this.
   */
  active: boolean;
  status: string;
}

/** Constant-ish credential check. Returns null on any failure (fail-closed). */
async function verifyStudent(username: string, password: string): Promise<VerifiedUser | null> {
  const row = await db.query.students.findFirst({
    where: or(
      eq(students.studentCode, username),
      eq(students.email, username.toLowerCase()),
    ),
  });
  if (!row || row.isArchived || !row.passwordEncrypted) return null;

  let ok = false;
  try {
    ok = decrypt(row.passwordEncrypted) === password;
  } catch {
    ok = false;
  }
  if (!ok) return null;

  return {
    id: row.id,
    code: row.studentCode,
    name: `${row.prefix ?? ''}${row.firstName} ${row.lastName}`.trim(),
    role: 'student',
    active: row.status === 'studying',
    status: row.status,
  };
}

async function verifyTeacher(username: string, password: string): Promise<VerifiedUser | null> {
  const row = await db.query.teachers.findFirst({
    where: eq(teachers.teacherCode, username),
  });
  if (!row || row.isArchived || !row.passwordEncrypted) return null;

  let ok = false;
  try {
    ok = decrypt(row.passwordEncrypted) === password;
  } catch {
    ok = false;
  }
  if (!ok) return null;

  return {
    id: row.id,
    code: row.teacherCode,
    // The DB role (`teacher` | `teacher-admin`) is the system-wide source of
    // truth for staff privilege — consumers authorize against it.
    name: `${row.prefix ?? ''}${row.firstName} ${row.lastName}`.trim(),
    role: row.role,
    active: row.employmentStatus === 'active',
    status: row.employmentStatus,
  };
}

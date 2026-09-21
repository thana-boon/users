import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { students, teachers } from '@/db/schema';
import { getSessionFromRequest } from './auth';
import { hasPermission, USERS_WRITE, type SessionClaims } from './jwt';
import type { SelfEditAudience } from './services/settings';

/**
 * RBAC for the Records module.
 *
 * Access rule: the SSO portal issues role `teacher`|`student` + a `permissions`
 * list; this admin-only module requires the `users:write` permission (granted
 * by the portal only to admin staff). `teacher`/`student` without it get valid
 * platform tokens but are rejected here. Auth is enforced in middleware AND
 * re-checked at each API route (defence in depth) — never trusted from the UI.
 */

export type Guard =
  | { ok: true; session: SessionClaims }
  | { ok: false; response: NextResponse };

/** The signed-in person's own row, for the self-service routes. */
export interface SelfPerson {
  id: number;
  /** teacher_code or student_code — the login id, and the audit label. */
  code: string;
  firstName: string;
  lastName: string;
  /** False for someone who has left: they may still read, not write. */
  active: boolean;
}

export type SelfGuard =
  | { ok: true; session: SessionClaims; audience: 'teacher'; teacher: SelfPerson }
  | { ok: false; response: NextResponse };

/** Either audience: a teacher OR a student, editing their own record. */
export type AnySelfGuard =
  | { ok: true; session: SessionClaims; audience: SelfEditAudience; person: SelfPerson }
  | { ok: false; response: NextResponse };

function deny(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Require a valid token carrying the `users:write` permission. */
export async function requireTeacherAdmin(req: NextRequest): Promise<Guard> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return { ok: false, response: deny(401, 'ต้องเข้าสู่ระบบก่อนใช้งาน') };
  }
  if (!hasPermission(session, USERS_WRITE)) {
    return {
      ok: false,
      response: deny(403, 'ไม่มีสิทธิ์เข้าถึงโมดูลนี้ (ต้องมีสิทธิ์ users:write)'),
    };
  }
  return { ok: true, session };
}

/**
 * Require a signed-in TEACHER — any teacher, admin or not — and hand back the
 * row they are signed in as.
 *
 * The one guard in this module that does not ask for `users:write`, because the
 * surface behind it (/api/users/me) is not the records module: it is the
 * teacher's own record, and the record is the authorisation. There is no id in
 * the URL to tamper with — the row is looked up from the token's `sub`, so the
 * route cannot be pointed at somebody else's profile.
 *
 * A student session is refused: local student login issues a `student` role, and
 * there is no student row in `teachers` for it to mean anything against.
 */
export async function requireSelfTeacher(req: NextRequest): Promise<SelfGuard> {
  const guard = await requireSelf(req);
  if (!guard.ok) return guard;
  if (guard.audience !== 'teacher') {
    return { ok: false, response: deny(403, 'หน้านี้สำหรับบัญชีครูเท่านั้น') };
  }
  return { ok: true, session: guard.session, audience: 'teacher', teacher: guard.person };
}

/**
 * The same, for either audience — a teacher OR a student on their own record.
 * Which one it is comes from the token's role and never from the request, so a
 * student cannot ask to be read out of the teachers table.
 */
export async function requireSelf(req: NextRequest): Promise<AnySelfGuard> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return { ok: false, response: deny(401, 'ต้องเข้าสู่ระบบก่อนใช้งาน') };
  }

  if (session.role === 'teacher') {
    const me = await db.query.teachers.findFirst({
      where: eq(teachers.teacherCode, session.sub),
      columns: {
        id: true, teacherCode: true, firstName: true, lastName: true,
        isArchived: true, employmentStatus: true,
      },
    });
    // A token outliving its row (archived, or deleted between login and now):
    // fail closed rather than 500 on the next lookup.
    if (!me || me.isArchived) {
      return { ok: false, response: deny(403, 'ไม่พบบัญชีครูของผู้ใช้นี้ในระบบ') };
    }
    return {
      ok: true,
      session,
      audience: 'teacher',
      person: {
        id: me.id,
        code: me.teacherCode,
        firstName: me.firstName,
        lastName: me.lastName,
        active: me.employmentStatus === 'active',
      },
    };
  }

  if (session.role === 'student') {
    const me = await db.query.students.findFirst({
      where: eq(students.studentCode, session.sub),
      columns: {
        id: true, studentCode: true, firstName: true, lastName: true,
        isArchived: true, status: true,
      },
    });
    if (!me || me.isArchived) {
      return { ok: false, response: deny(403, 'ไม่พบบัญชีนักเรียนของผู้ใช้นี้ในระบบ') };
    }
    return {
      ok: true,
      session,
      audience: 'student',
      person: {
        id: me.id,
        code: me.studentCode,
        firstName: me.firstName,
        lastName: me.lastName,
        // Someone who has left keeps their login (other services still use it)
        // but stops editing a roll they are no longer on. Reading stays open.
        active: me.status === 'studying',
      },
    };
  }

  return { ok: false, response: deny(403, 'บัญชีนี้ไม่มีระเบียนของตนเองในระบบ') };
}

/** True if the session may reveal/decrypt sensitive fields. */
export function canRevealSensitive(session: SessionClaims | null): boolean {
  return hasPermission(session, USERS_WRITE);
}

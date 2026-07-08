import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from './auth';
import type { SessionClaims } from './jwt';

/**
 * RBAC for the Records module.
 *
 * Access rule (Scope ข้อ 8): ONLY `teacher-admin` may read/write this module.
 * `teacher` and `student` get valid tokens elsewhere but are rejected here.
 * Auth is enforced in middleware AND re-checked at each API route (defence in
 * depth) - never trusted from the UI alone.
 */

export type Guard =
  | { ok: true; session: SessionClaims }
  | { ok: false; response: NextResponse };

function deny(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Require a valid token whose role is exactly `teacher-admin`. */
export async function requireTeacherAdmin(req: NextRequest): Promise<Guard> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return { ok: false, response: deny(401, 'ต้องเข้าสู่ระบบก่อนใช้งาน') };
  }
  if (session.role !== 'teacher-admin') {
    return {
      ok: false,
      response: deny(403, 'เฉพาะ teacher-admin เท่านั้นที่เข้าถึงโมดูลนี้ได้'),
    };
  }
  return { ok: true, session };
}

/** True if the role may reveal/decrypt sensitive fields. */
export function canRevealSensitive(session: SessionClaims | null): boolean {
  return session?.role === 'teacher-admin';
}

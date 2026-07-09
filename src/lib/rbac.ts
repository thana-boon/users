import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from './auth';
import { hasPermission, USERS_WRITE, type SessionClaims } from './jwt';

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

/** True if the session may reveal/decrypt sensitive fields. */
export function canRevealSensitive(session: SessionClaims | null): boolean {
  return hasPermission(session, USERS_WRITE);
}

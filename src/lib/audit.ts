import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import type { SessionClaims } from './jwt';
import { clientIp } from './ip';

/**
 * Append-only audit trail. Every reveal/decrypt of sensitive data and every
 * mutation of student/teacher records is recorded: who, when, whose data.
 * Writing an audit row must never break the underlying request, so failures
 * are swallowed (and logged to stderr).
 */

export type AuditAction =
  | 'reveal_password'
  | 'reveal_citizen_id'
  | 'reveal_income'
  | 'create'
  | 'update'
  | 'delete'
  | 'archive'
  | 'restore'
  | 'import'
  | 'export'
  | 'login'
  | 'promote'
  | 'transfer_room'
  | 'place_student'
  | 'assign_homeroom'
  | 'renumber'
  | 'withdraw'
  | 'graduate'
  | 'reinstate'
  | 'leave_start'
  | 'leave_end'
  | 'resign'
  | 'reveal_api_key'
  | 'create_api_key'
  | 'revoke_api_key'
  | 'rotate_api_key'
  | 'api_read'
  | 'backup'
  | 'restore_backup'
  | 'download_backup'
  | 'upload_backup'
  | 'delete_backup';

export interface AuditInput {
  session: SessionClaims | null;
  action: AuditAction;
  targetType:
    | 'student'
    | 'teacher'
    | 'worker'
    | 'special_teacher'
    | 'subject_group'
    | 'academic_year'
    | 'enrollment'
    | 'homeroom'
    | 'promotion'
    | 'auth'
    | 'api_key'
    | 'backup';
  targetId?: number | null;
  targetLabel?: string | null;
  detail?: string | null;
  req?: NextRequest;
  /**
   * Override the actor columns for callers that have no session — i.e. an API
   * key hitting /api/public/v1/*. Without this the row would land with a null
   * actor and the trail could not say WHICH integration read the data.
   */
  actorLabel?: string | null;
  actorRole?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    // `sub` is a username (e.g. "T00116"), not the teacher.id — only store it
    // as the numeric FK when it actually is numeric; otherwise rely on the label.
    const sub = input.session?.sub;
    const numericActor = sub && /^\d+$/.test(sub) ? Number(sub) : null;
    await db.insert(auditLogs).values({
      actorId: numericActor,
      actorRole: input.actorRole ?? input.session?.role ?? null,
      actorLabel:
        input.actorLabel ?? input.session?.name ?? input.session?.code ?? sub ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      detail: input.detail ?? null,
      ip: clientIp(input.req),
      userAgent: input.req?.headers.get('user-agent')?.slice(0, 255) ?? null,
    });
  } catch (err) {
    console.error('[audit] failed to record', input.action, err);
  }
}

export interface FailedLoginInput {
  req: NextRequest;
  /** Which login form was used — the two have separate identifier spaces. */
  audience: 'teacher' | 'student';
  /** teacher_code / student_code / email, exactly as it was typed. */
  identifier: string;
  /** The row it matched, when it matched one at all. */
  targetId?: number | null;
  /** Why it failed, for the admin reading the trail — never sent to the caller. */
  reason: string;
  /** This failure is the one that locked the account. */
  locked?: boolean;
  /** This failure is the one that spent the calling IP's failure budget. */
  ipExhausted?: boolean;
}

/**
 * Record a login attempt that did NOT succeed.
 *
 * WHY: successes were audited and failures were not, which left the one
 * question worth asking during an outage — "are these people getting their
 * password wrong, or are we the ones turning them away?" — unanswerable from
 * the trail. It had to be reconstructed from the gateway's access log, by
 * whoever had shell on the server.
 *
 * Safe to write on every failure because the per-IP failure budget bounds how
 * many one address can produce in a window: once it is spent the route answers
 * 429 without reaching here. The two 429 paths deliberately write nothing of
 * their own — the cause is already on the row that exhausted the budget or
 * locked the account, and a row per rejection would hand a flood the ability to
 * write our audit table for us.
 *
 * The REASON is recorded even though the HTTP reply stays deliberately uniform
 * ("code or password is wrong"). The uniformity is there so a stranger cannot
 * enumerate who exists; this table is readable only by `users:write` admins,
 * who can already list every account, so spelling it out costs nothing and is
 * exactly what a support question needs.
 *
 * NOT EVERY FAILURE WRITES A ROW. An attempt on an identifier that matches no
 * account is dropped unless it locked something or spent the caller's budget.
 * Not thrift — signal: the portal tries teacher-login before student-login, so
 * every student who signs in correctly manufactures one "no such teacher" miss
 * on the way past. Keeping those would put a noise row beside every real one
 * and make the trail useless for the exact question it was added to answer.
 * A miss also tells an attacker nothing (the reply is identical either way), so
 * what remains worth recording about them is the flood, which the budget-spent
 * row captures.
 */
export async function recordFailedLogin(i: FailedLoginInput): Promise<void> {
  const known = i.targetId != null;
  if (!known && !i.locked && !i.ipExhausted) return;

  const detail = [
    i.audience === 'teacher' ? 'เข้าสู่ระบบครู' : 'เข้าสู่ระบบนักเรียน',
    i.reason,
    i.locked ? 'บัญชีถูกล็อกชั่วคราว' : null,
    i.ipExhausted ? 'IP นี้ใช้โควตาความพยายามที่ล้มเหลวหมดแล้ว' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  await recordAudit({
    session: null,
    actorLabel: i.identifier.slice(0, 128),
    actorRole: 'anonymous',
    action: 'login',
    targetType: 'auth',
    targetId: i.targetId ?? null,
    targetLabel: `${i.identifier.slice(0, 100)} · ล้มเหลว`,
    detail,
    req: i.req,
  });
}

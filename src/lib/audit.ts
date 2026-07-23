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
  | 'resign'
  | 'reveal_api_key'
  | 'create_api_key'
  | 'revoke_api_key'
  | 'rotate_api_key'
  | 'api_read';

export interface AuditInput {
  session: SessionClaims | null;
  action: AuditAction;
  targetType:
    | 'student'
    | 'teacher'
    | 'worker'
    | 'academic_year'
    | 'enrollment'
    | 'homeroom'
    | 'promotion'
    | 'auth'
    | 'api_key';
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

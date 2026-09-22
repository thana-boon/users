import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { students, teachers } from '@/db/schema';
import { requireSelf } from '@/lib/rbac';
import { handleError, notFound } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { tryDecrypt } from '@/lib/crypto';
import { sensitiveClosedMessage, sensitiveSelfEditEnabled } from '@/lib/services/settings';

export const runtime = 'nodejs';

/**
 * POST /api/users/me/reveal — my own เลขบัตรประชาชน, in the clear.
 *
 * The self-service twin of the admin reveal routes, and the same bargain:
 * the number is decrypted only when asked for, one click at a time, and every
 * click leaves an audit row naming who asked. /api/users/me keeps returning the
 * masked form — this route is the only way the full value reaches a browser
 * outside the office, so there is exactly one place to look when asking "who
 * has seen this".
 *
 * Gated by the school-wide sensitive switch (/users/settings). Two things it is
 * deliberately NOT gated by:
 *
 *  - the audience self-edit window. Reading your own id back is not an edit,
 *    and a closed window means "we are not taking changes this week", not "you
 *    may not see what we hold about you". Saving a correction still needs both.
 *  - `person.active`. Someone who has resigned or graduated has more reason to
 *    check what the school still holds, not less.
 *
 * POST rather than GET for the same reason the admin routes use it: a URL that
 * returns a decrypted id must not be something a browser can prefetch, a
 * history entry can replay, or a proxy can cache.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSelf(req);
  if (!guard.ok) return guard.response;

  try {
    if (!(await sensitiveSelfEditEnabled())) {
      return Response.json({ error: sensitiveClosedMessage() }, { status: 403 });
    }

    const { audience, person } = guard;
    const row =
      audience === 'teacher'
        ? await db.query.teachers.findFirst({
            where: eq(teachers.id, person.id),
            columns: { citizenIdEncrypted: true },
          })
        : await db.query.students.findFirst({
            where: eq(students.id, person.id),
            columns: { citizenIdEncrypted: true },
          });
    if (!row) return notFound();

    // tryDecrypt, not decrypt: a row encrypted under a retired key must report
    // "ไม่มีข้อมูล" rather than 500 on a page the person opened about themselves.
    const value = tryDecrypt(row.citizenIdEncrypted);

    await recordAudit({
      session: guard.session,
      action: 'reveal_citizen_id',
      targetType: audience,
      targetId: person.id,
      targetLabel: `${person.code} ${person.firstName} ${person.lastName}`,
      // Says it was the person's own record, not an admin looking someone up —
      // the distinction the log is read for.
      detail: 'ดูเลขบัตรประชาชนของตนเอง',
      req,
    });

    return Response.json(
      { field: 'citizen_id', value },
      // Never let anything between here and the browser keep a copy.
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleError(err);
  }
}

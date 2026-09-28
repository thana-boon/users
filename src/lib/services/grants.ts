import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffGrants, teachers } from '@/db/schema';
import {
  capPerm,
  isCapability,
  USERS_READ,
  USERS_WRITE,
  type Capability,
} from '@/lib/permissions';

/**
 * Moderator grants (`staff_grants`) — read at login to build the session's
 * permissions, and on every moderator API request by the route guard, so that
 * TAKING a capability away bites on the very next request instead of when the
 * session runs out. (Giving one still needs a re-login: middleware, which runs
 * on the edge with no database, only knows what the token says.)
 */

/** A teacher's grants. Unknown keys (from an older build) are dropped. */
export async function grantsOf(teacherId: number): Promise<Capability[]> {
  const row = await db.query.staffGrants.findFirst({
    where: eq(staffGrants.teacherId, teacherId),
    columns: { capabilities: true },
  });
  return (row?.capabilities ?? []).filter(isCapability);
}

/** The same, looked up by the session's `sub` (teacher_code). */
export async function grantsOfCode(teacherCode: string): Promise<Capability[]> {
  const [row] = await db
    .select({ capabilities: staffGrants.capabilities })
    .from(staffGrants)
    .innerJoin(teachers, eq(teachers.id, staffGrants.teacherId))
    .where(and(eq(teachers.teacherCode, teacherCode), eq(teachers.isArchived, false)))
    .limit(1);
  return (row?.capabilities ?? []).filter(isCapability);
}

/** DB role + grants → what a session minted for that teacher may do. */
export async function sessionPermissions(t: { id: number; role: string }): Promise<string[]> {
  if (t.role === 'teacher-admin') return [USERS_READ, USERS_WRITE];
  return (await grantsOf(t.id)).map(capPerm);
}

/**
 * Does this teacher account hold any power in the module — admin, or any
 * moderator grant? A moderator may edit ordinary teachers' records but not
 * archive, resign or take over one of these: that would let one moderator
 * lock out another, or an admin.
 */
export async function isPrivilegedTeacher(teacherId: number): Promise<boolean> {
  const t = await db.query.teachers.findFirst({
    where: eq(teachers.id, teacherId),
    columns: { role: true },
  });
  if (t?.role === 'teacher-admin') return true;
  return (await grantsOf(teacherId)).length > 0;
}

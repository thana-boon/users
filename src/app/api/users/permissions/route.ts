import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, asc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { staffGrants, teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { CAPABILITIES, CAPABILITY_KEYS, isCapability, type Capability } from '@/lib/permissions';

export const runtime = 'nodejs';

/**
 * GET /api/users/permissions               — the accounts that HOLD access
 *                                            (admins + moderators), nobody else.
 * GET /api/users/permissions?candidates=q  — teachers to add, by code / name.
 * PUT /api/users/permissions               — { teacherId, access, capabilities }
 *     access 'admin'     → teachers.role = teacher-admin, grants row removed
 *     access 'moderator' → role = teacher, grants row = capabilities (≥ 1)
 *     access 'none'      → role = teacher, grants row removed (ถอนสิทธิ์)
 *
 * Admin-only. Two changes are refused because they cannot be undone from this
 * page: changing your OWN access (an admin who demotes themselves is locked out
 * of the page that would put it back), and demoting the LAST active admin.
 *
 * The session carries permissions from login, so a new grant shows up at that
 * person's next sign-in; a removed one stops working at once, because the route
 * guard re-reads grants from the database on every moderator request.
 */

const ACCESS = ['admin', 'moderator', 'none'] as const;
type Access = (typeof ACCESS)[number];

const putSchema = z.object({
  teacherId: z.number().int().positive(),
  access: z.enum(ACCESS),
  capabilities: z.array(z.string()).default([]),
});

const capLabel = (c: Capability) => CAPABILITIES.find((x) => x.key === c)!.label;

function describe(access: Access, caps: Capability[]): string {
  if (access === 'admin') return 'ผู้ดูแลระบบ';
  if (access === 'none') return 'ไม่มีสิทธิ์';
  return `moderator (${caps.map(capLabel).join(', ')})`;
}

const personCols = {
  id: teachers.id,
  teacherCode: teachers.teacherCode,
  prefix: teachers.prefix,
  firstName: teachers.firstName,
  lastName: teachers.lastName,
  subjectGroup: teachers.subjectGroup,
  role: teachers.role,
  employmentStatus: teachers.employmentStatus,
  // Never the base64 itself — see the list routes.
  hasPhoto: sql<boolean>`${teachers.photoBase64} is not null`,
  capabilities: staffGrants.capabilities,
  grantedBy: staffGrants.updatedByLabel,
  grantedAt: staffGrants.updatedAt,
};

function shape(r: {
  role: string;
  capabilities: string[] | null;
} & Record<string, unknown>) {
  const caps = (r.capabilities ?? []).filter(isCapability);
  const access: Access = r.role === 'teacher-admin' ? 'admin' : caps.length ? 'moderator' : 'none';
  return { ...r, access, capabilities: access === 'moderator' ? caps : [] };
}

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const candidates = req.nextUrl.searchParams.get('candidates');

    if (candidates !== null) {
      const q = candidates.trim();
      if (!q) return ok({ rows: [] });
      const like = `%${q}%`;
      const rows = await db
        .select(personCols)
        .from(teachers)
        .leftJoin(staffGrants, eq(staffGrants.teacherId, teachers.id))
        .where(
          and(
            eq(teachers.isArchived, false),
            or(
              ilike(teachers.teacherCode, like),
              ilike(teachers.firstName, like),
              ilike(teachers.lastName, like),
              ilike(sql`${teachers.firstName} || ' ' || ${teachers.lastName}`, like),
            ),
          ),
        )
        .orderBy(asc(teachers.teacherCode))
        .limit(20);
      return ok({ rows: rows.map(shape) });
    }

    const rows = await db
      .select(personCols)
      .from(teachers)
      .leftJoin(staffGrants, eq(staffGrants.teacherId, teachers.id))
      .where(
        and(
          eq(teachers.isArchived, false),
          or(eq(teachers.role, 'teacher-admin'), sql`${staffGrants.teacherId} is not null`),
        ),
      )
      .orderBy(
        sql`case ${teachers.role} when 'teacher-admin' then 0 else 1 end`,
        asc(teachers.teacherCode),
      );

    return ok({
      // A grants row whose keys all went stale is nobody's access — hide it.
      rows: rows.map(shape).filter((r) => r.access !== 'none'),
      me: guard.session.sub,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = putSchema.parse(await req.json());
    const caps = [...new Set(body.capabilities)].filter(isCapability);
    if (body.capabilities.some((c) => !isCapability(c))) {
      return badRequest('มีสิทธิ์ที่ระบบไม่รู้จัก');
    }
    if (body.access === 'moderator' && caps.length === 0) {
      return badRequest('เลือกอย่างน้อย 1 สิทธิ์ให้ moderator');
    }

    const t = await db.query.teachers.findFirst({
      where: and(eq(teachers.id, body.teacherId), eq(teachers.isArchived, false)),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true, role: true },
    });
    if (!t) return notFound('ไม่พบบัญชีครูนี้');

    if (t.teacherCode === guard.session.sub) {
      return badRequest('เปลี่ยนสิทธิ์ของตนเองไม่ได้ — ให้ผู้ดูแลคนอื่นเป็นผู้เปลี่ยน');
    }
    if (t.role === 'teacher-admin' && body.access !== 'admin') {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(teachers)
        .where(
          and(
            eq(teachers.role, 'teacher-admin'),
            eq(teachers.isArchived, false),
            eq(teachers.employmentStatus, 'active'),
            ne(teachers.id, t.id),
          ),
        );
      if (n === 0) return badRequest('ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน — เพิ่มผู้ดูแลคนอื่นก่อน');
    }

    const before = await db.query.staffGrants.findFirst({
      where: eq(staffGrants.teacherId, t.id),
      columns: { capabilities: true },
    });
    const beforeCaps = (before?.capabilities ?? []).filter(isCapability);
    const beforeAccess: Access =
      t.role === 'teacher-admin' ? 'admin' : beforeCaps.length ? 'moderator' : 'none';

    // Keep CAPABILITY_KEYS order so the stored list (and the audit line) reads
    // the same way the tick-boxes do.
    const ordered = CAPABILITY_KEYS.filter((c) => caps.includes(c));

    await db.transaction(async (tx) => {
      // `moderator` in the enum is legacy — normalise it away on any change.
      const role = body.access === 'admin' ? 'teacher-admin' : 'teacher';
      if (t.role !== role) await tx.update(teachers).set({ role }).where(eq(teachers.id, t.id));

      if (body.access === 'moderator') {
        await tx
          .insert(staffGrants)
          .values({ teacherId: t.id, capabilities: ordered, updatedByLabel: guard.session.sub })
          .onConflictDoUpdate({
            target: staffGrants.teacherId,
            set: { capabilities: ordered, updatedByLabel: guard.session.sub, updatedAt: new Date() },
          });
      } else {
        await tx.delete(staffGrants).where(inArray(staffGrants.teacherId, [t.id]));
      }
    });

    await recordAudit({
      session: guard.session,
      action: 'change_role',
      targetType: 'teacher',
      targetId: t.id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail: `เปลี่ยนสิทธิ์: ${describe(beforeAccess, beforeCaps)} -> ${describe(body.access, ordered)}`,
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

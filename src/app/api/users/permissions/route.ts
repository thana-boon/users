import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { teachers, TEACHER_ROLES, type TeacherRole } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * GET   /api/users/permissions?q=&role=  — every active teacher account and its role.
 * PATCH /api/users/permissions           — { teacherId, role }: change one account's role.
 *
 * Admin-only. The role lives on `teachers.role` and is turned into session
 * permissions at login (lib/permissions.ts permissionsForRole), so a change
 * takes effect the next time that person signs in — the page says so.
 *
 * Two changes are refused because they cannot be undone from this page:
 * changing your OWN role (an admin demoting themselves is locked out of the
 * very page that would put it back), and demoting the LAST active admin.
 */

const patchSchema = z.object({
  teacherId: z.number().int().positive(),
  role: z.enum(TEACHER_ROLES),
});

const ROLE_LABEL: Record<TeacherRole, string> = {
  teacher: 'ครู',
  moderator: 'moderator',
  'teacher-admin': 'ผู้ดูแลระบบ',
};

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const role = (sp.get('role') ?? '').trim();

    const conds = [eq(teachers.isArchived, false)];
    if ((TEACHER_ROLES as readonly string[]).includes(role)) {
      conds.push(eq(teachers.role, role as TeacherRole));
    }
    if (q) {
      const like = `%${q}%`;
      conds.push(
        or(
          ilike(teachers.teacherCode, like),
          ilike(teachers.firstName, like),
          ilike(teachers.lastName, like),
          ilike(sql`${teachers.firstName} || ' ' || ${teachers.lastName}`, like),
        )!,
      );
    }

    const [rows, counts] = await Promise.all([
      db
        .select({
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
        })
        .from(teachers)
        .where(and(...conds))
        // Privileged accounts first: they are what this page is for.
        .orderBy(
          sql`case ${teachers.role} when 'teacher-admin' then 0 when 'moderator' then 1 else 2 end`,
          asc(teachers.teacherCode),
        ),
      db
        .select({ role: teachers.role, n: sql<number>`count(*)::int` })
        .from(teachers)
        .where(eq(teachers.isArchived, false))
        .groupBy(teachers.role),
    ]);

    const byRole = Object.fromEntries(TEACHER_ROLES.map((r) => [r, 0])) as Record<TeacherRole, number>;
    for (const c of counts) byRole[c.role] = c.n;

    return ok({ rows, counts: byRole, me: guard.session.sub });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = patchSchema.parse(await req.json());
    const t = await db.query.teachers.findFirst({
      where: and(eq(teachers.id, body.teacherId), eq(teachers.isArchived, false)),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true, role: true },
    });
    if (!t) return notFound('ไม่พบบัญชีครูนี้');
    if (t.role === body.role) return ok({ ok: true, role: t.role });

    if (t.teacherCode === guard.session.sub) {
      return badRequest('เปลี่ยนสิทธิ์ของตนเองไม่ได้ — ให้ผู้ดูแลคนอื่นเป็นผู้เปลี่ยน');
    }
    if (t.role === 'teacher-admin') {
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

    await db.update(teachers).set({ role: body.role }).where(eq(teachers.id, t.id));
    await recordAudit({
      session: guard.session,
      action: 'change_role',
      targetType: 'teacher',
      targetId: t.id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail: `เปลี่ยนสิทธิ์: ${ROLE_LABEL[t.role]} -> ${ROLE_LABEL[body.role]}`,
      req,
    });
    return ok({ ok: true, role: body.role });
  } catch (err) {
    return handleError(err);
  }
}

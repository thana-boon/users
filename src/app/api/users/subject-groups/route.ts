import type { NextRequest } from 'next/server';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { specialTeachers, subjectGroups, teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, created, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { cleanGroupName, ensureSubjectGroups } from '@/lib/services/subject-groups';

export const runtime = 'nodejs';

/**
 * กลุ่มสาระ — the school's own list, and the source of every กลุ่มสาระ dropdown.
 *
 * GET  /api/users/subject-groups  ?withCounts=1  ?includeInactive=1
 * POST /api/users/subject-groups
 *
 * The row count per group is computed by matching the NAME against the two
 * roster columns, not by a foreign key — see src/lib/services/subject-groups.ts
 * for why the rosters were left as text.
 */

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    // Cheap after the first call, and it means a group typed straight into the
    // database (or restored from a backup taken before this table existed)
    // still shows up in the picker instead of vanishing.
    await ensureSubjectGroups();

    const sp = req.nextUrl.searchParams;
    const includeInactive = sp.get('includeInactive') === '1';
    const withCounts = sp.get('withCounts') === '1';

    const rows = await db
      .select({
        id: subjectGroups.id,
        name: subjectGroups.name,
        sortOrder: subjectGroups.sortOrder,
        isActive: subjectGroups.isActive,
      })
      .from(subjectGroups)
      .where(includeInactive ? undefined : eq(subjectGroups.isActive, true))
      .orderBy(asc(subjectGroups.sortOrder), asc(subjectGroups.name));

    if (!withCounts) return ok({ data: rows });

    // Two grouped scans over ~120 + ~30 rows — far cheaper than a count query
    // per group, and it also surfaces `orphans`: names a roster carries that no
    // group row matches. That list should always be empty; if it is not, the
    // page says so instead of letting those people quietly drop out of reports.
    const [teacherCounts, specialCounts] = await Promise.all([
      db
        .select({ v: teachers.subjectGroup, n: sql<number>`count(*)::int` })
        .from(teachers)
        .where(eq(teachers.isArchived, false))
        .groupBy(teachers.subjectGroup),
      db
        .select({ v: specialTeachers.subjectGroup, n: sql<number>`count(*)::int` })
        .from(specialTeachers)
        .where(eq(specialTeachers.isArchived, false))
        .groupBy(specialTeachers.subjectGroup),
    ]);

    const tMap = new Map(teacherCounts.map((r) => [r.v ?? '', Number(r.n)]));
    const sMap = new Map(specialCounts.map((r) => [r.v ?? '', Number(r.n)]));
    const named = new Set(rows.map((r) => r.name));

    const orphans = [...new Set([...tMap.keys(), ...sMap.keys()])]
      .filter((name) => name && !named.has(name))
      .map((name) => ({
        name,
        teacherCount: tMap.get(name) ?? 0,
        specialTeacherCount: sMap.get(name) ?? 0,
      }));

    return ok({
      data: rows.map((r) => ({
        ...r,
        teacherCount: tMap.get(r.name) ?? 0,
        specialTeacherCount: sMap.get(r.name) ?? 0,
      })),
      orphans,
    });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = createSchema.parse(await req.json());
    const name = cleanGroupName(body.name);
    if (!name) return badRequest('กรุณากรอกชื่อกลุ่มสาระ');
    if (name.length > 191) return badRequest('ชื่อกลุ่มสาระยาวเกิน 191 ตัวอักษร');

    const dup = await db.query.subjectGroups.findFirst({
      where: eq(subjectGroups.name, name),
      columns: { id: true },
    });
    if (dup) return badRequest('กลุ่มสาระนี้มีอยู่แล้ว');

    const [maxRow] = await db
      .select({ n: sql<number>`coalesce(max(${subjectGroups.sortOrder}), 0)::int` })
      .from(subjectGroups);

    const [row] = await db
      .insert(subjectGroups)
      .values({ name, sortOrder: body.sortOrder ?? Number(maxRow?.n ?? 0) + 10 })
      .returning({ id: subjectGroups.id });

    await recordAudit({
      session: guard.session,
      action: 'create',
      targetType: 'subject_group',
      targetId: row.id,
      targetLabel: name,
      req,
    });
    return created({ id: row.id });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * PUT /api/users/subject-groups — save the whole display order in one go, which
 * is what the reorder buttons actually mean: two rows swap, and persisting them
 * one at a time would leave a duplicate order behind if the second call failed.
 */
const reorderSchema = z.object({ ids: z.array(z.number().int().positive()).min(1) });

export async function PUT(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const { ids } = reorderSchema.parse(await req.json());
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        await tx
          .update(subjectGroups)
          .set({ sortOrder: (i + 1) * 10 })
          .where(eq(subjectGroups.id, id));
      }
    });
    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'subject_group',
      detail: `จัดลำดับกลุ่มสาระใหม่ (${ids.length} รายการ)`,
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

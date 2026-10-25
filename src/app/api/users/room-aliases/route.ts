import type { NextRequest } from 'next/server';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { enrollments, roomAliases, students } from '@/db/schema';
import { requireAccess } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { resolveActiveYearId } from '@/lib/services/students';
import { cleanAlias, readAliasMap, roomKey } from '@/lib/services/room-aliases';
import { compareGrades } from '@/lib/grades';

export const runtime = 'nodejs';

/** Sort ห้อง strings numerically when possible ('2' before '10'). */
const byRoom = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });

export interface AliasRoom {
  gradeLevel: string;
  classroom: string;
  studentCount: number;
  alias: string | null;
}

/**
 * GET /api/users/room-aliases?yearId=
 *
 * Every (grade, classroom) with students in the year, plus any room that has
 * an alias but no students this year — so a name set last year stays visible
 * and can be cleared. Aliases themselves are not per year.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();

    const [roomRows, aliases] = await Promise.all([
      db
        .select({
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          n: sql<number>`count(*)`,
        })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(
          and(
            eq(enrollments.academicYearId, yearId),
            eq(students.isArchived, false),
            eq(students.status, 'studying'),
          ),
        )
        .groupBy(enrollments.gradeLevel, enrollments.classroom),
      readAliasMap(),
    ]);

    const byKey = new Map<string, AliasRoom>();
    for (const r of roomRows) {
      if (!r.gradeLevel || !r.classroom) continue;
      const key = roomKey(r.gradeLevel, r.classroom);
      byKey.set(key, {
        gradeLevel: r.gradeLevel,
        classroom: r.classroom,
        studentCount: Number(r.n),
        alias: aliases.get(key) ?? null,
      });
    }
    for (const [key, alias] of aliases) {
      if (byKey.has(key)) continue;
      const [gradeLevel, classroom] = key.split('|');
      byKey.set(key, { gradeLevel, classroom, studentCount: 0, alias });
    }

    const rooms = [...byKey.values()].sort(
      (a, b) => compareGrades(a.gradeLevel, b.gradeLevel) || byRoom(a.classroom, b.classroom),
    );
    return ok({ yearId, rooms });
  } catch (err) {
    return handleError(err);
  }
}

const saveSchema = z.object({
  gradeLevel: z.string().min(1).max(32),
  classroom: z.string().min(1).max(16),
  // Empty = remove the alias; the room shows its number again.
  alias: z.string().max(64),
});

/** POST — set or clear the alias of one room (grade+classroom). */
export async function POST(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const body = saveSchema.parse(await req.json());
    const alias = cleanAlias(body.alias);
    const label = `${body.gradeLevel}/${body.classroom}`;

    const existing = await db.query.roomAliases.findFirst({
      where: and(eq(roomAliases.gradeLevel, body.gradeLevel), eq(roomAliases.classroom, body.classroom)),
    });

    if (!alias) {
      if (!existing) return ok({ ok: true });
      await db.delete(roomAliases).where(eq(roomAliases.id, existing.id));
      await recordAudit({
        session: guard.session,
        action: 'set_room_alias',
        targetType: 'room',
        targetLabel: label,
        detail: `ลบชื่อห้อง "${existing.alias}"`,
        req,
      });
      return ok({ ok: true });
    }

    // Two rooms of the same ชั้น under one name would be exactly the confusion
    // the number is kept to prevent.
    const clash = await db.query.roomAliases.findFirst({
      where: and(
        eq(roomAliases.gradeLevel, body.gradeLevel),
        ne(roomAliases.classroom, body.classroom),
        sql`lower(${roomAliases.alias}) = lower(${alias})`,
      ),
    });
    if (clash) return badRequest(`ชื่อ "${alias}" ใช้กับห้อง ${clash.gradeLevel}/${clash.classroom} แล้ว`);

    if (existing?.alias === alias) return ok({ ok: true });
    await db
      .insert(roomAliases)
      .values({ gradeLevel: body.gradeLevel, classroom: body.classroom, alias })
      .onConflictDoUpdate({
        target: [roomAliases.gradeLevel, roomAliases.classroom],
        set: { alias, updatedAt: new Date() },
      });

    await recordAudit({
      session: guard.session,
      action: 'set_room_alias',
      targetType: 'room',
      targetLabel: label,
      detail: existing ? `"${existing.alias}" → "${alias}"` : `ตั้งชื่อห้อง "${alias}"`,
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

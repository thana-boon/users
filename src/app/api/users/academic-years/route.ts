import type { NextRequest } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears, enrollments } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, created, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const rows = await db
      .select({
        id: academicYears.id,
        year: academicYears.year,
        startDate: academicYears.startDate,
        endDate: academicYears.endDate,
        isActive: academicYears.isActive,
        isArchived: academicYears.isArchived,
        studentCount: sql<number>`count(${enrollments.id})`,
      })
      .from(academicYears)
      .leftJoin(enrollments, eq(enrollments.academicYearId, academicYears.id))
      .groupBy(academicYears.id)
      .orderBy(desc(academicYears.year));
    return ok({ data: rows.map((r) => ({ ...r, studentCount: Number(r.studentCount) })) });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  year: z.number().int().min(2400).max(2700),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  setActive: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = createSchema.parse(await req.json());
    const dup = await db.query.academicYears.findFirst({
      where: eq(academicYears.year, body.year),
    });
    if (dup) return badRequest('มีปีการศึกษานี้ในระบบแล้ว');

    if (body.setActive) {
      await db.update(academicYears).set({ isActive: false });
    }
    const [row] = await db
      .insert(academicYears)
      .values({
        year: body.year,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        isActive: body.setActive,
      })
      .returning({ id: academicYears.id });
    await recordAudit({
      session: guard.session,
      action: 'create',
      targetType: 'academic_year',
      targetId: row.id,
      targetLabel: String(body.year),
      req,
    });
    return created({ id: row.id });
  } catch (err) {
    return handleError(err);
  }
}

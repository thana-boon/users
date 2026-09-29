import type { NextRequest } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students, enrollments } from '@/db/schema';
import { requireAccess } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  enrollmentId: z.number().int(),
  classNumber: z.string().trim().max(16).nullable(),
});

/**
 * POST /api/users/students/[id]/class-number — set one student's เลขที่ from
 * the registry. A number already held by someone else in the same room is
 * still saved (two rows swapping numbers pass through a clash), but the
 * clashing classmates come back so the roll can flag them.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = schema.parse(await req.json());

    const raw = body.classNumber || null;
    if (raw && !/^\d{1,3}$/.test(raw)) return badRequest('เลขที่ต้องเป็นตัวเลข 1–3 หลัก');
    // "07" and "7" are the same seat.
    const classNumber = raw ? String(Number(raw)) : null;
    if (classNumber === '0') return badRequest('เลขที่ต้องมากกว่า 0');

    const [row] = await db
      .select({
        studentCode: students.studentCode, firstName: students.firstName, lastName: students.lastName,
        academicYearId: enrollments.academicYearId, gradeLevel: enrollments.gradeLevel,
        classroom: enrollments.classroom, classNumber: enrollments.classNumber,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.id, body.enrollmentId), eq(enrollments.studentId, id)));
    if (!row) return notFound();

    if (row.classNumber !== classNumber) {
      // The roll is ordered by seqOrder, so it follows the number.
      await db
        .update(enrollments)
        .set(classNumber ? { classNumber, seqOrder: Number(classNumber) } : { classNumber })
        .where(eq(enrollments.id, body.enrollmentId));
      await recordAudit({
        session: guard.session,
        action: 'update',
        targetType: 'student',
        targetId: id,
        targetLabel: `${row.studentCode} ${row.firstName} ${row.lastName}`,
        detail: `เลขที่ ${row.classNumber ?? '–'} → ${classNumber ?? '–'}`,
        req,
      });
    }

    const duplicates = classNumber && row.gradeLevel && row.classroom
      ? await db
        .select({
          id: students.id, prefix: students.prefix,
          firstName: students.firstName, lastName: students.lastName,
        })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(and(
          eq(enrollments.academicYearId, row.academicYearId),
          eq(enrollments.gradeLevel, row.gradeLevel),
          eq(enrollments.classroom, row.classroom),
          eq(enrollments.classNumber, classNumber),
          ne(enrollments.studentId, id),
          eq(students.status, 'studying'),
          eq(students.isArchived, false),
        ))
      : [];

    return ok({ classNumber, duplicates });
  } catch (err) {
    return handleError(err);
  }
}

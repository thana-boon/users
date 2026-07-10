import type { NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears, students } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { placeStudents } from '@/lib/services/promotion';

export const runtime = 'nodejs';

const newStudentSchema = z.object({
  studentCode: z.string().trim().min(1),
  prefix: z.string().nullable().optional(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  gender: z.string().nullable().optional(),
});

const schema = z.object({
  yearId: z.number().int(),
  grade: z.string().nullable().optional(),
  renumber: z.boolean().default(false),
  items: z
    .array(
      z
        .object({
          studentId: z.number().int().nullable().optional(),
          newStudent: newStudentSchema.nullable().optional(),
          targetClassroom: z.string().nullable().optional(),
        })
        // Exactly one source per item: an existing student or a new one.
        .refine((it) => (it.studentId != null) !== (it.newStudent != null), {
          message: 'แต่ละรายการต้องระบุ studentId หรือ newStudent อย่างใดอย่างหนึ่ง',
        }),
    )
    .min(1, 'ต้องเลือกนักเรียนอย่างน้อย 1 คน'),
});

/**
 * POST /api/users/placements — จัดนักเรียนเข้าห้อง: enroll students into a
 * (year, grade, room). Each item is either an existing student or a brand-new
 * quick-add student to create. Validates that quick-add codes are unique (both
 * against the DB and within the batch) before committing.
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = schema.parse(await req.json());

    const year = await db.query.academicYears.findFirst({
      where: eq(academicYears.id, body.yearId),
    });
    if (!year) return badRequest('ไม่พบปีการศึกษา');

    // Validate new-student codes: no duplicates within the batch, none already used.
    const newCodes = body.items
      .map((i) => i.newStudent?.studentCode?.trim())
      .filter((c): c is string => !!c);
    if (newCodes.length) {
      const dupInBatch = newCodes.find((c, i) => newCodes.indexOf(c) !== i);
      if (dupInBatch) return badRequest(`รหัสนักเรียนซ้ำในรายการ: ${dupInBatch}`);
      const existing = await db
        .select({ code: students.studentCode })
        .from(students)
        .where(inArray(students.studentCode, newCodes));
      if (existing.length) {
        return badRequest(`รหัสนักเรียนนี้มีในระบบแล้ว: ${existing.map((e) => e.code).join(', ')}`);
      }
    }

    const result = await placeStudents({
      yearId: body.yearId,
      grade: body.grade ?? null,
      renumber: body.renumber,
      items: body.items.map((i) => ({
        studentId: i.studentId ?? null,
        newStudent: i.newStudent ?? null,
        targetClassroom: i.targetClassroom ?? null,
      })),
    });

    await recordAudit({
      session: guard.session,
      action: 'place_student',
      targetType: 'enrollment',
      targetLabel: `${year.year}${body.grade ? ` • ${body.grade}` : ''}`,
      detail: `จัดเข้าห้อง ${result.placed} คน (เพิ่มใหม่ ${result.created} คน)`,
      req,
    });

    return ok({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}

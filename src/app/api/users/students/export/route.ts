import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { buildStudentExport, type StudentExportRow } from '@/lib/excel-io';
import { resolveActiveYearId } from '@/lib/services/students';

export const runtime = 'nodejs';

/**
 * GET /api/users/students/export?yearId=&grade=&classroom=
 * Bulk PII export (decrypts password/citizen/income) - teacher-admin only,
 * and every export is audit-logged.
 */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    const grade = (sp.get('grade') ?? '').trim();
    const classroom = (sp.get('classroom') ?? '').trim();

    // Pull students that have an enrollment in this year (+ optional filters).
    const conds = [eq(enrollments.academicYearId, yearId), eq(students.isArchived, false)];
    if (grade) conds.push(eq(enrollments.gradeLevel, grade));
    if (classroom) conds.push(eq(enrollments.classroom, classroom));

    const ids = await db
      .select({ id: students.id })
      .from(students)
      .innerJoin(enrollments, eq(enrollments.studentId, students.id))
      .where(and(...conds));

    const rows: StudentExportRow[] = [];
    for (const { id } of ids) {
      const s = await db.query.students.findFirst({
        where: eq(students.id, id),
        with: { addresses: true, guardians: true, previousSchool: true, health: true },
      });
      if (!s) continue;
      const en = await db.query.enrollments.findFirst({
        where: and(eq(enrollments.studentId, id), eq(enrollments.academicYearId, yearId)),
      });
      const addrByType: Record<string, Record<string, unknown>> = {};
      for (const a of s.addresses) addrByType[a.addressType] = a as Record<string, unknown>;
      const gByType: Record<string, Record<string, unknown>> = {};
      for (const g of s.guardians) gByType[g.guardianType] = g as Record<string, unknown>;
      rows.push({
        student: s as StudentExportRow['student'],
        enrollment: en
          ? {
              gradeLevel: en.gradeLevel,
              classroom: en.classroom,
              classNumber: en.classNumber,
              seqOrder: en.seqOrder,
            }
          : null,
        addresses: addrByType,
        previousSchool: (s.previousSchool as Record<string, unknown>) ?? null,
        guardians: gByType,
        health: (s.health as Record<string, unknown>) ?? null,
      });
    }

    const buf = await buildStudentExport(rows);
    await recordAudit({
      session: guard.session,
      action: 'export',
      targetType: 'student',
      detail: `ส่งออก ${rows.length} รายการ (yearId=${yearId}${grade ? `, grade=${grade}` : ''})`,
      req,
    });

    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="students_${yearId}.xlsx"`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

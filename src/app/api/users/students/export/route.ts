import type { NextRequest } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { buildStudentExport, type StudentExportRow } from '@/lib/excel-io';
import { resolveActiveYearId } from '@/lib/services/students';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

    const idRows = await db
      .select({ id: students.id })
      .from(students)
      .innerJoin(enrollments, eq(enrollments.studentId, students.id))
      .where(and(...conds));
    const ids = idRows.map((r) => r.id);

    let rows: StudentExportRow[] = [];
    if (ids.length > 0) {
      // Batch: two queries total (students+relations, then this year's
      // enrollments) instead of one findFirst per student — no more N+1, so the
      // export no longer holds a pooled connection for hundreds of round-trips.
      const [studentRows, enrRows] = await Promise.all([
        db.query.students.findMany({
          where: inArray(students.id, ids),
          with: { addresses: true, guardians: true, previousSchool: true, health: true },
        }),
        db.query.enrollments.findMany({
          where: and(inArray(enrollments.studentId, ids), eq(enrollments.academicYearId, yearId)),
        }),
      ]);
      const enrByStudent = new Map(enrRows.map((e) => [e.studentId, e]));

      // Preserve the ordered id list from the filtered join above.
      const byId = new Map(studentRows.map((s) => [s.id, s]));
      rows = ids.flatMap((id) => {
        const s = byId.get(id);
        if (!s) return [];
        const en = enrByStudent.get(id);
        const addrByType: Record<string, Record<string, unknown>> = {};
        for (const a of s.addresses) addrByType[a.addressType] = a as Record<string, unknown>;
        const gByType: Record<string, Record<string, unknown>> = {};
        for (const g of s.guardians) gByType[g.guardianType] = g as Record<string, unknown>;
        return [
          {
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
          },
        ];
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

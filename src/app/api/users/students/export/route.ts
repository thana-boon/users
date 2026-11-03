import type { NextRequest } from 'next/server';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments } from '@/db/schema';
import { requireAccess } from '@/lib/rbac';
import { handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { buildStudentExport, type StudentExportRow } from '@/lib/excel-io';
import { ALL_STUDENT_ZONE_KEYS, studentExportColumns } from '@/lib/student-export-zones';
import { resolveActiveYearId } from '@/lib/services/students';
import { gradeRank, roomRank, roomText, classNumberRank } from '@/lib/grade-sql';

export const runtime = 'nodejs';
export const maxDuration = 120;

const TEST_STUDENT_CODE = '00000';

/**
 * GET /api/users/students/export?yearId=&grade=&classroom=&zones=&withdrawn=1
 * zones = comma-separated keys from STUDENT_EXPORT_ZONES (absent = all, the
 * re-importable 157 columns); withdrawn=1 adds ลาออก students + a สถานะ column.
 * Bulk PII export (decrypts password/citizen/income) - teacher-admin only,
 * and every export is audit-logged.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAccess(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    const grade = (sp.get('grade') ?? '').trim();
    const classroom = (sp.get('classroom') ?? '').trim();
    const zonesParam = sp.get('zones');
    const zones = zonesParam === null
      ? ALL_STUDENT_ZONE_KEYS
      : zonesParam.split(',').filter((k) => ALL_STUDENT_ZONE_KEYS.includes(k));
    const partial = zones.length < ALL_STUDENT_ZONE_KEYS.length;
    const withWithdrawn = sp.get('withdrawn') === '1';

    // Pull students that have an enrollment in this year (+ optional filters).
    const conds = [
      eq(enrollments.academicYearId, yearId),
      eq(students.isArchived, false),
      // withdrawn/graduated students keep their enrollment row but are off the
      // roll; ลาออก comes back only when asked for, graduated never does
      withWithdrawn
        ? inArray(students.status, ['studying', 'withdrawn'])
        : eq(students.status, 'studying'),
      // 00000 is the test student, never part of a real class list
      ne(students.studentCode, TEST_STUDENT_CODE),
    ];
    if (grade) conds.push(eq(enrollments.gradeLevel, grade));
    if (classroom) conds.push(eq(enrollments.classroom, classroom));

    const idRows = await db
      .select({ id: students.id })
      .from(students)
      .innerJoin(enrollments, eq(enrollments.studentId, students.id))
      .where(and(...conds))
      // Same ชั้น order as the registry (เตรียมอนุบาล → อ → ป → ม): the sheet is
      // read as a class list, so it must not come out in insertion order.
      .orderBy(
        gradeRank(enrollments.gradeLevel),
        roomRank(enrollments.classroom),
        roomText(enrollments.classroom),
        classNumberRank(enrollments.classNumber),
        enrollments.seqOrder,
        students.studentCode,
      );
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

    const buf = await buildStudentExport(rows, {
      cols: partial ? studentExportColumns(zones) : undefined,
      statusOf: withWithdrawn
        ? (r) => (r.student.status === 'withdrawn' ? 'ลาออก' : 'กำลังศึกษา')
        : undefined,
    });
    await recordAudit({
      session: guard.session,
      action: 'export',
      targetType: 'student',
      detail: `ส่งออก ${rows.length} รายการ (yearId=${yearId}${grade ? `, grade=${grade}` : ''}${classroom ? `, classroom=${classroom}` : ''}${partial ? `, zones=${zones.join('|') || '-'}` : ''}${withWithdrawn ? ', รวมลาออก' : ''})`,
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

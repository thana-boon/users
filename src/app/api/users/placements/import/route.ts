import type { NextRequest } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears, students, enrollments } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { importPlacements } from '@/lib/services/promotion';

export const runtime = 'nodejs';

/**
 * POST /api/users/placements/import
 *
 * Bulk-place many students into (year, grade, room) from a CSV the client parsed
 * into rows of { studentCode, gradeLevel, classroom }. Two-phase like the other
 * imports: dryRun=true validates + previews (matches each code to an existing
 * student, flags bad rows) WITHOUT writing; dryRun=false commits only when every
 * row is valid. Students must already exist — a code not in the system is an
 * error row (this import never creates students; use the registry import / pool
 * quick-add for brand-new students first).
 */

const schema = z.object({
  yearId: z.number().int(),
  renumber: z.boolean().default(false),
  dryRun: z.boolean().default(true),
  rows: z
    .array(
      z.object({
        studentCode: z.string(),
        gradeLevel: z.string().nullable().optional(),
        classroom: z.string().nullable().optional(),
      }),
    )
    .min(1, 'ไม่มีข้อมูลในไฟล์'),
});

interface RowIssue { row: number; studentCode: string; errors: string[] }
interface PreviewRow {
  row: number; studentCode: string; name: string;
  gradeLevel: string; classroom: string; action: 'new' | 'update';
}

const fullName = (s: { prefix: string | null; firstName: string; lastName: string }) =>
  `${s.prefix ?? ''}${s.firstName} ${s.lastName}`.trim();

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = schema.parse(await req.json());

    const year = await db.query.academicYears.findFirst({
      where: eq(academicYears.id, body.yearId),
    });
    if (!year) return badRequest('ไม่พบปีการศึกษา');

    // Resolve every referenced code once.
    const codes = [...new Set(body.rows.map((r) => r.studentCode.trim()).filter(Boolean))];
    const found = codes.length
      ? await db
          .select({
            id: students.id,
            studentCode: students.studentCode,
            prefix: students.prefix,
            firstName: students.firstName,
            lastName: students.lastName,
            isArchived: students.isArchived,
          })
          .from(students)
          .where(inArray(students.studentCode, codes))
      : [];
    const byCode = new Map(found.map((s) => [s.studentCode, s]));

    // Which of the found students are already on this year's roll (→ update vs new).
    const foundIds = found.map((s) => s.id);
    const enrolled = foundIds.length
      ? await db
          .select({ studentId: enrollments.studentId })
          .from(enrollments)
          .where(and(eq(enrollments.academicYearId, body.yearId), inArray(enrollments.studentId, foundIds)))
      : [];
    const enrolledSet = new Set(enrolled.map((e) => e.studentId));

    const issues: RowIssue[] = [];
    const preview: PreviewRow[] = [];
    const resolved: { studentId: number; gradeLevel: string; classroom: string }[] = [];
    const seen = new Map<string, number>();

    body.rows.forEach((r, i) => {
      const rowNo = i + 1;
      const code = r.studentCode.trim();
      const grade = (r.gradeLevel ?? '').trim();
      const room = (r.classroom ?? '').trim();
      const errs: string[] = [];

      if (!code) errs.push('ขาดรหัสนักเรียน');
      if (!grade) errs.push('ขาดชั้น');
      if (!room) errs.push('ขาดห้อง');

      let student: (typeof found)[number] | undefined;
      if (code) {
        const prev = seen.get(code);
        if (prev) errs.push(`รหัสซ้ำกับแถวที่ ${prev} ในไฟล์`);
        else seen.set(code, rowNo);
        student = byCode.get(code);
        if (!student) errs.push('ไม่พบรหัสนักเรียนในระบบ');
        else if (student.isArchived) errs.push('นักเรียนถูกเก็บถาวร/ลบแล้ว');
      }

      if (errs.length || !student) {
        issues.push({ row: rowNo, studentCode: code, errors: errs });
        return;
      }
      resolved.push({ studentId: student.id, gradeLevel: grade, classroom: room });
      preview.push({
        row: rowNo, studentCode: code, name: fullName(student),
        gradeLevel: grade, classroom: room,
        action: enrolledSet.has(student.id) ? 'update' : 'new',
      });
    });

    const summary = {
      totalRows: body.rows.length,
      valid: resolved.length,
      invalid: issues.length,
      dryRun: body.dryRun,
      year: year.year,
    };

    if (body.dryRun) {
      return ok({ ...summary, committed: 0, issues, preview });
    }
    if (issues.length > 0) {
      return badRequest('พบแถวที่ผิดพลาด แก้ไขก่อนนำเข้า (ยังไม่บันทึก)', { ...summary, issues, preview });
    }

    const result = await importPlacements({ yearId: body.yearId, renumber: body.renumber, rows: resolved });

    await recordAudit({
      session: guard.session,
      action: 'place_student',
      targetType: 'enrollment',
      targetLabel: `นำเข้า CSV • ปี ${year.year}`,
      detail: `จัดเข้าห้องจาก CSV ${result.placed} คน${body.renumber ? ' (รันเลขที่ใหม่)' : ''}`,
      req,
    });

    return ok({ ...summary, committed: result.placed, issues: [], preview });
  } catch (err) {
    return handleError(err);
  }
}

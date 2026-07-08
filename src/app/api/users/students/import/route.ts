import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { readSheetRows } from '@/lib/excel-io';
import { parseStudentRow } from '@/lib/excel-map';
import { isValidCitizenId } from '@/lib/thai';
import { resolveActiveYearId, upsertStudentFull } from '@/lib/services/students';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/users/students/import   (multipart: file=<xlsx>, dryRun=true|false)
 * Validates every row (13-digit citizen id checksum, required fields, dup code
 * within file) and reports errors BEFORE committing. With dryRun=true it only
 * reports. Otherwise valid rows are upserted into the active academic year.
 */
interface RowIssue {
  row: number;
  studentCode: string;
  errors: string[];
}

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const form = await req.formData();
    const file = form.get('file');
    const dryRun = String(form.get('dryRun') ?? 'true').toLowerCase() === 'true';
    if (!(file instanceof File)) return badRequest('กรุณาแนบไฟล์ .xlsx');

    const buf = Buffer.from(await file.arrayBuffer());
    const rawRows = await readSheetRows(buf);
    if (rawRows.length === 0) return badRequest('ไฟล์ไม่มีข้อมูล');

    const issues: RowIssue[] = [];
    const parsedRows: { rowNo: number; parsed: NonNullable<ReturnType<typeof parseStudentRow>> }[] = [];
    const seen = new Map<string, number>();

    rawRows.forEach((raw, i) => {
      const rowNo = i + 2; // +1 header, +1 to 1-index
      const parsed = parseStudentRow(raw);
      if (!parsed) return; // blank row, skip silently
      const errs: string[] = [];

      if (!parsed.core.studentCode) errs.push('ขาดรหัสนักเรียน');
      if (!parsed.core.firstName && !parsed.core.lastName) errs.push('ขาดชื่อ-นามสกุล');
      if (!isValidCitizenId(parsed.core.citizenId))
        errs.push('เลขบัตรประชาชนไม่ถูกต้อง (ต้อง 13 หลักและ checksum ถูกต้อง)');

      const prev = seen.get(parsed.core.studentCode);
      if (prev) errs.push(`รหัสซ้ำกับแถวที่ ${prev} ในไฟล์`);
      else seen.set(parsed.core.studentCode, rowNo);

      if (errs.length) issues.push({ row: rowNo, studentCode: parsed.core.studentCode, errors: errs });
      else parsedRows.push({ rowNo, parsed });
    });

    const summary = {
      totalRows: rawRows.length,
      valid: parsedRows.length,
      invalid: issues.length,
      dryRun,
    };

    if (dryRun) {
      return ok({ ...summary, committed: 0, issues });
    }
    if (issues.length > 0) {
      return badRequest('พบแถวที่ผิดพลาด แก้ไขก่อนนำเข้า (ยังไม่ commit)', { ...summary, issues });
    }

    const yearId = await resolveActiveYearId();
    let createdCount = 0;
    let updatedCount = 0;
    for (const { parsed } of parsedRows) {
      const res = await upsertStudentFull(parsed, yearId);
      if (res.created) createdCount++;
      else updatedCount++;
    }

    await recordAudit({
      session: guard.session,
      action: 'import',
      targetType: 'student',
      detail: `นำเข้า ${parsedRows.length} รายการ (ใหม่ ${createdCount}, อัปเดต ${updatedCount})`,
      req,
    });

    return ok({ ...summary, committed: parsedRows.length, created: createdCount, updated: updatedCount, issues: [] });
  } catch (err) {
    return handleError(err);
  }
}

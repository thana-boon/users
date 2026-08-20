import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { specialTeachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { readSheetRows } from '@/lib/excel-io';
import { parseSpecialTeacherRow } from '@/lib/excel-map';
import { listActiveNames, snapSubjectGroup } from '@/lib/services/subject-groups';

export const runtime = 'nodejs';

/**
 * POST /api/users/special-teachers/import (multipart: file, dryRun)
 *
 * Two-step like every other import: ตรวจสอบ reports the bad rows, ยืนยัน writes
 * only when there are none. Existing รหัส are updated in place, so re-importing
 * a corrected sheet is safe and does not duplicate anybody.
 *
 * The กลุ่มสาระ column is checked against the กลุ่มสาระ list rather than taken
 * as written: a cell that folds onto a known group is stored with the group's
 * own spelling, and a cell that matches nothing is a row error naming what to
 * do about it. Letting a typo through here is precisely what would split a
 * group in two and break the `?subjectGroup=` queries other systems run.
 */
interface RowIssue {
  row: number;
  specialTeacherCode: string;
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

    const known = await listActiveNames();

    const issues: RowIssue[] = [];
    const valid: NonNullable<ReturnType<typeof parseSpecialTeacherRow>>[] = [];
    const seen = new Map<string, number>();

    rawRows.forEach((raw, i) => {
      const rowNo = i + 2; // +1 for the header, +1 because spreadsheets are 1-based
      const t = parseSpecialTeacherRow(raw);
      if (!t) return;
      const errs: string[] = [];
      if (!t.firstName || !t.lastName) errs.push('ขาดชื่อหรือนามสกุล');

      const snapped = snapSubjectGroup(t.subjectGroup, known);
      if (snapped === undefined) {
        errs.push(`ไม่พบกลุ่มสาระ “${t.subjectGroup}” — เพิ่มที่หน้ากลุ่มสาระก่อน หรือแก้ให้ตรงกับรายการ`);
      } else {
        t.subjectGroup = snapped;
      }

      const prev = seen.get(t.specialTeacherCode);
      if (prev) errs.push(`รหัสซ้ำกับแถว ${prev}`);
      else seen.set(t.specialTeacherCode, rowNo);

      if (errs.length) issues.push({ row: rowNo, specialTeacherCode: t.specialTeacherCode, errors: errs });
      else valid.push(t);
    });

    const summary = { totalRows: rawRows.length, valid: valid.length, invalid: issues.length, dryRun };
    if (dryRun) return ok({ ...summary, committed: 0, issues });
    if (issues.length) return badRequest('พบแถวที่ผิดพลาด แก้ไขก่อนนำเข้า', { ...summary, issues });

    let createdCount = 0;
    let updatedCount = 0;
    for (const t of valid) {
      const existing = await db.query.specialTeachers.findFirst({
        where: eq(specialTeachers.specialTeacherCode, t.specialTeacherCode),
        columns: { id: true },
      });
      // `is_archived` is deliberately absent: re-importing the sheet must not
      // resurrect someone who was moved to ถังขยะ — restoring is its own action.
      const base = {
        prefix: t.prefix,
        firstName: t.firstName,
        lastName: t.lastName,
        subjectGroup: t.subjectGroup,
        phone: t.phone,
      };
      if (existing) {
        await db.update(specialTeachers).set(base).where(eq(specialTeachers.id, existing.id));
        updatedCount++;
      } else {
        await db
          .insert(specialTeachers)
          .values({ specialTeacherCode: t.specialTeacherCode, ...base });
        createdCount++;
      }
    }

    await recordAudit({
      session: guard.session,
      action: 'import',
      targetType: 'special_teacher',
      detail: `นำเข้า ${valid.length} รายการ (ใหม่ ${createdCount}, อัปเดต ${updatedCount})`,
      req,
    });

    return ok({
      ...summary,
      committed: valid.length,
      created: createdCount,
      updated: updatedCount,
      issues: [],
    });
  } catch (err) {
    return handleError(err);
  }
}

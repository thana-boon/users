import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { readSheetRows } from '@/lib/excel-io';
import { parseTeacherRow } from '@/lib/excel-map';
import { encrypt } from '@/lib/crypto';
import { isValidCitizenId } from '@/lib/thai';

export const runtime = 'nodejs';

/**
 * POST /api/users/teachers/import (multipart: file, dryRun)
 * Imports teachers. `Password` column is plain text -> encrypted here.
 * NEW teachers land as role=teacher; role is never set from the file
 * (promotion to teacher-admin is a deliberate UI action).
 */
interface RowIssue {
  row: number;
  teacherCode: string;
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
    const valid: NonNullable<ReturnType<typeof parseTeacherRow>>[] = [];
    const seen = new Map<string, number>();

    rawRows.forEach((raw, i) => {
      const rowNo = i + 2;
      const t = parseTeacherRow(raw);
      if (!t) return;
      const errs: string[] = [];
      if (!t.teacherCode) errs.push('ขาดรหัสครู');
      if (!t.firstName && !t.lastName) errs.push('ขาดชื่อ-นามสกุล');
      if (!isValidCitizenId(t.citizenId)) errs.push('เลขบัตรประชาชนไม่ถูกต้อง');
      const prev = seen.get(t.teacherCode);
      if (prev) errs.push(`รหัสซ้ำกับแถว ${prev}`);
      else seen.set(t.teacherCode, rowNo);
      if (errs.length) issues.push({ row: rowNo, teacherCode: t.teacherCode, errors: errs });
      else valid.push(t);
    });

    const summary = { totalRows: rawRows.length, valid: valid.length, invalid: issues.length, dryRun };
    if (dryRun) return ok({ ...summary, committed: 0, issues });
    if (issues.length) return badRequest('พบแถวที่ผิดพลาด แก้ไขก่อนนำเข้า', { ...summary, issues });

    let createdCount = 0;
    let updatedCount = 0;
    for (const t of valid) {
      const existing = await db.query.teachers.findFirst({
        where: eq(teachers.teacherCode, t.teacherCode),
        columns: { id: true },
      });
      const base = {
        prefix: t.prefix,
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email,
        subjectGroup: t.subjectGroup,
        gradeTaught: t.gradeTaught,
        citizenIdEncrypted: encrypt(t.citizenId),
        passwordEncrypted: encrypt(t.plainPassword),
      };
      if (existing) {
        // Do NOT touch role on re-import (preserve promotions).
        await db.update(teachers).set(base).where(eq(teachers.id, existing.id));
        updatedCount++;
      } else {
        await db.insert(teachers).values({ teacherCode: t.teacherCode, role: 'teacher', ...base });
        createdCount++;
      }
    }

    await recordAudit({
      session: guard.session,
      action: 'import',
      targetType: 'teacher',
      detail: `นำเข้า ${valid.length} รายการ (ใหม่ ${createdCount}, อัปเดต ${updatedCount})`,
      req,
    });

    return ok({ ...summary, committed: valid.length, created: createdCount, updated: updatedCount, issues: [] });
  } catch (err) {
    return handleError(err);
  }
}

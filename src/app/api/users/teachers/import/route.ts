import type { NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import {
  TEACHER_EDUCATION_SHEET,
  TEACHER_SCOUT_SHEET,
  TEACHER_TRAINING_SHEET,
  readTeacherWorkbook,
} from '@/lib/excel-io';
import {
  parseTeacherRow,
  parseTeacherEducationRow,
  parseTeacherScoutRow,
  parseTeacherTrainingRow,
  type ParsedQualificationRow,
} from '@/lib/excel-map';
import { replaceTeacherLists } from '@/lib/services/teachers';
import { encrypt } from '@/lib/crypto';
import { isValidCitizenId } from '@/lib/thai';
import { listActiveNames, snapSubjectGroup } from '@/lib/services/subject-groups';

export const runtime = 'nodejs';

/**
 * POST /api/users/teachers/import (multipart: file, dryRun)
 * Imports teachers. `Password` column is plain text -> encrypted here.
 * NEW teachers land as role=teacher; role is never set from the file
 * (promotion to teacher-admin is a deliberate UI action).
 *
 * `กลุ่มสาระที่สอน` is checked against the กลุ่มสาระ list rather than written
 * as typed: a cell that folds onto a known group is stored with that group's
 * own spelling, and a cell matching nothing is reported as a row error. This is
 * the same gate the UI dropdown provides — without it, one spreadsheet with a
 * stray space would split a group in two behind everyone's back, which is
 * precisely what the กลุ่มสาระ page exists to stop.
 *
 * THE THREE EXTRA SHEETS (วุฒิการศึกษา / วุฒิลูกเสือ / การอบรม) are optional and
 * their rule is: a sheet that is NOT in the file changes nothing, and a teacher
 * who IS named in a sheet has their whole list for that sheet replaced by what
 * the file says. That pairing matters — "replace" is the only sane meaning for
 * a file that is the list, but a missing tab must not be read as "delete
 * everything", or exporting the roster, fixing a phone number in a copy without
 * the tabs and re-importing would wipe every teacher's certificates.
 *
 * A row pointing at a teacher code that is not in the database is reported like
 * any other row error, so a typo does not silently drop somebody's degrees.
 */
interface RowIssue {
  row: number;
  teacherCode: string;
  errors: string[];
  /** Which sheet the row is on — absent for the main roster sheet. */
  sheet?: string;
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
    const { main: rawRows, extra } = await readTeacherWorkbook(buf, [
      TEACHER_EDUCATION_SHEET,
      TEACHER_SCOUT_SHEET,
      TEACHER_TRAINING_SHEET,
    ]);
    if (rawRows.length === 0) return badRequest('ไฟล์ไม่มีข้อมูล');

    const known = await listActiveNames();

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

      const snapped = snapSubjectGroup(t.subjectGroup, known);
      if (snapped === undefined) {
        errs.push(`ไม่พบกลุ่มสาระ “${t.subjectGroup}” — เพิ่มที่หน้ากลุ่มสาระก่อน หรือแก้ให้ตรงกับรายการ`);
      } else {
        t.subjectGroup = snapped;
      }

      const prev = seen.get(t.teacherCode);
      if (prev) errs.push(`รหัสซ้ำกับแถว ${prev}`);
      else seen.set(t.teacherCode, rowNo);
      if (errs.length) issues.push({ row: rowNo, teacherCode: t.teacherCode, errors: errs });
      else valid.push(t);
    });

    // -- the three optional sheets -----------------------------------
    // Grouped per teacher code. A code counts as known if the main sheet is
    // about to create it OR it is already in the database, so a workbook that
    // introduces a teacher and their degrees in one go validates cleanly.
    const lists = {
      educations: collect(extra[TEACHER_EDUCATION_SHEET], TEACHER_EDUCATION_SHEET, parseTeacherEducationRow, issues),
      scoutQualifications: collect(extra[TEACHER_SCOUT_SHEET], TEACHER_SCOUT_SHEET, parseTeacherScoutRow, issues),
      trainings: collect(extra[TEACHER_TRAINING_SHEET], TEACHER_TRAINING_SHEET, parseTeacherTrainingRow, issues),
    };

    const referenced = new Set<string>([
      ...lists.educations.keys(),
      ...lists.scoutQualifications.keys(),
      ...lists.trainings.keys(),
    ]);
    const unknownCodes = await findUnknownCodes(referenced, seen);
    for (const [sheet, byCode] of Object.entries(lists)) {
      for (const [code, entry] of byCode) {
        if (!unknownCodes.has(code)) continue;
        issues.push({
          row: entry.firstRow,
          teacherCode: code,
          sheet: sheetNameOf(sheet),
          errors: [`ไม่พบรหัสครู “${code}” ทั้งในไฟล์และในระบบ`],
        });
      }
    }

    const listRowCount =
      countRows(lists.educations) +
      countRows(lists.scoutQualifications) +
      countRows(lists.trainings);

    const summary = {
      totalRows: rawRows.length,
      valid: valid.length,
      invalid: issues.length,
      dryRun,
      // Reported separately from `totalRows`, which has always meant the roster
      // sheet and is what the import dialog counts against.
      qualificationRows: listRowCount,
      qualificationTeachers: referenced.size,
    };
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

    // Qualification lists, after the roster — a teacher created a moment ago
    // now has an id to hang them on. Each teacher gets ONE call so the three
    // lists land in one transaction, and a list absent from the workbook is
    // absent from the call, which is what leaves it untouched.
    let listTeachers = 0;
    for (const code of referenced) {
      const row = await db.query.teachers.findFirst({
        where: eq(teachers.teacherCode, code),
        columns: { id: true },
      });
      if (!row) continue; // validated above; a race here is not worth failing on
      await replaceTeacherLists(row.id, {
        educations: lists.educations.get(code)?.rows,
        scoutQualifications: lists.scoutQualifications.get(code)?.rows,
        trainings: lists.trainings.get(code)?.rows,
      });
      listTeachers++;
    }

    await recordAudit({
      session: guard.session,
      action: 'import',
      targetType: 'teacher',
      detail:
        `นำเข้า ${valid.length} รายการ (ใหม่ ${createdCount}, อัปเดต ${updatedCount})` +
        (listRowCount
          ? ` · วุฒิ/การอบรม ${listRowCount} แถว ของครู ${listTeachers} คน`
          : ''),
      req,
    });

    return ok({
      ...summary,
      committed: valid.length,
      created: createdCount,
      updated: updatedCount,
      qualificationTeachersCommitted: listTeachers,
      issues: [],
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Rows of one extra sheet, grouped by teacher code, in sheet order. */
interface CodeEntry<T> {
  firstRow: number;
  rows: T[];
}

function collect<T>(
  raw: unknown[][] | undefined,
  sheet: string,
  parse: (r: unknown[]) => ParsedQualificationRow<T> | null,
  issues: RowIssue[],
): Map<string, CodeEntry<T>> {
  const out = new Map<string, CodeEntry<T>>();
  if (!raw) return out; // sheet absent = leave every list alone
  raw.forEach((r, i) => {
    const rowNo = i + 2;
    const parsed = parse(r);
    if (parsed) {
      const entry = out.get(parsed.teacherCode) ?? { firstRow: rowNo, rows: [] };
      entry.rows.push(parsed.row);
      out.set(parsed.teacherCode, entry);
      return;
    }
    // Not parsed: a blank row (fine, skip) — or a row with a certificate typed
    // into it and no teacher code, which cannot be filed against anyone.
    // Reported rather than dropped, since silently losing a typed certificate
    // is the one outcome nobody would notice.
    if (hasAnyCell(r) && !String(r[0] ?? '').trim()) {
      issues.push({ row: rowNo, teacherCode: '', sheet, errors: ['ขาดรหัสครูผู้สอนในแถวนี้'] });
    }
  });
  return out;
}

/** True if any cell past the teacher code holds something. */
function hasAnyCell(r: unknown[]): boolean {
  return r.some((v, i) => i > 1 && v !== null && v !== undefined && String(v).trim() !== '');
}

function countRows<T>(byCode: Map<string, CodeEntry<T>>): number {
  let n = 0;
  for (const e of byCode.values()) n += e.rows.length;
  return n;
}

/** Codes referenced by a sheet that neither the file nor the database knows. */
async function findUnknownCodes(
  referenced: Set<string>,
  inFile: Map<string, number>,
): Promise<Set<string>> {
  const toCheck = [...referenced].filter((c) => !inFile.has(c));
  if (toCheck.length === 0) return new Set();
  const rows = await db
    .select({ code: teachers.teacherCode })
    .from(teachers)
    .where(inArray(teachers.teacherCode, toCheck));
  const known = new Set(rows.map((r) => r.code));
  return new Set(toCheck.filter((c) => !known.has(c)));
}

/** The sheet's Thai name, from the key used in the `lists` object above. */
function sheetNameOf(key: string): string {
  if (key === 'educations') return TEACHER_EDUCATION_SHEET;
  if (key === 'scoutQualifications') return TEACHER_SCOUT_SHEET;
  return TEACHER_TRAINING_SHEET;
}

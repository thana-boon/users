import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import {
  COMPLETION_FIELDS,
  type CompletionKey,
  type CompletionPerson,
  type CompletionReport,
} from '@/lib/completion-fields';

/**
 * ติดตามการกรอกข้อมูล — for every teacher working now, which of the profile
 * fields are still empty, so the office can see who to chase and for what.
 *
 * Two kinds of gap, kept apart because they are chased differently:
 *  - `teacher` fields the teacher fills in on ข้อมูลของฉัน — the reminder goes
 *    to them;
 *  - `office` fields the office sets on the teacher page (ตำแหน่ง, กลุ่มสาระ) —
 *    no point telling a teacher to fill in something they cannot edit.
 *
 * Read-only: nothing here writes, and a field counts as filled on any
 * non-blank value (it does not judge whether the value is right).
 */

export {
  COMPLETION_FIELDS,
  type CompletionKey,
  type CompletionPerson,
  type CompletionReport,
} from '@/lib/completion-fields';

const TEACHER_KEYS = COMPLETION_FIELDS.filter((f) => f.who === 'teacher').map((f) => f.key);

export interface CompletionRow {
  id: number;
  teacherCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  position: string | null;
  subjectGroup: string | null;
  phone: string | null;
  birthDate: string | null;
  workStart: string | null;
  emergencyContactName: string | null;
  emergencyPhone: string | null;
  addrSubDistrict: string | null;
  addrDistrict: string | null;
  addrProvince: string | null;
  teachingLicenseSource: string | null;
  educations: unknown[];
  scoutQualifications: unknown[];
}

const blank = (v: string | null | undefined) => !(v ?? '').trim();

export async function buildCompletion(): Promise<CompletionReport> {
  const rows = await db.query.teachers.findMany({
    where: and(eq(teachers.isArchived, false), eq(teachers.employmentStatus, 'active')),
    columns: {
      id: true, teacherCode: true, prefix: true, firstName: true, lastName: true,
      position: true, subjectGroup: true, phone: true, birthDate: true, workStart: true,
      emergencyContactName: true, emergencyPhone: true,
      addrSubDistrict: true, addrDistrict: true, addrProvince: true,
      teachingLicenseSource: true,
    },
    with: {
      educations: { columns: { id: true } },
      scoutQualifications: { columns: { id: true } },
    },
  });
  return computeCompletion(rows);
}

/** Pure: the report from already-loaded rows. */
export function computeCompletion(rows: CompletionRow[]): CompletionReport {
  const collator = new Intl.Collator('th');
  const empty: Record<CompletionKey, (r: CompletionRow) => boolean> = {
    phone: (r) => blank(r.phone),
    birthDate: (r) => blank(r.birthDate),
    workStart: (r) => blank(r.workStart),
    // Someone to call is a name AND a number; either alone is not reachable.
    emergency: (r) => blank(r.emergencyContactName) || blank(r.emergencyPhone),
    // Enough to find the place: ตำบล, อำเภอ and จังหวัด.
    address: (r) => blank(r.addrSubDistrict) || blank(r.addrDistrict) || blank(r.addrProvince),
    education: (r) => r.educations.length === 0,
    license: (r) => blank(r.teachingLicenseSource),
    scout: (r) => r.scoutQualifications.length === 0,
    position: (r) => blank(r.position),
    subjectGroup: (r) => blank(r.subjectGroup),
  };

  const people: CompletionPerson[] = rows.map((r) => {
    const gaps = COMPLETION_FIELDS.filter((f) => empty[f.key](r));
    const missing = gaps.filter((f) => f.who === 'teacher').map((f) => f.key);
    return {
      id: r.id,
      code: r.teacherCode,
      name: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
      subjectGroup: r.subjectGroup?.trim() || null,
      missing,
      officeMissing: gaps.filter((f) => f.who === 'office').map((f) => f.key),
      ratio: (TEACHER_KEYS.length - missing.length) / TEACHER_KEYS.length,
    };
  });
  // Most to chase first; then by name.
  people.sort((a, b) => b.missing.length - a.missing.length || collator.compare(a.name, b.name));

  const groupMap = new Map<string, CompletionPerson[]>();
  for (const p of people) {
    const g = p.subjectGroup ?? 'ไม่ระบุกลุ่มสาระ';
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g)!.push(p);
  }
  const groups = [...groupMap.entries()]
    .map(([label, ps]) => ({
      label,
      total: ps.length,
      complete: ps.filter((p) => p.missing.length === 0).length,
      ratio: ps.reduce((s, p) => s + p.ratio, 0) / ps.length,
    }))
    .sort((a, b) => a.ratio - b.ratio || collator.compare(a.label, b.label));

  const filledSlots = people.reduce((s, p) => s + (TEACHER_KEYS.length - p.missing.length), 0);
  return {
    asOf: new Date().toISOString(),
    total: people.length,
    complete: people.filter((p) => p.missing.length === 0).length,
    overall: people.length ? filledSlots / (people.length * TEACHER_KEYS.length) : 1,
    fields: COMPLETION_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      who: f.who,
      missing: people.filter((p) => (f.who === 'teacher' ? p.missing : p.officeMissing).includes(f.key)).length,
    })),
    groups,
    people,
  };
}

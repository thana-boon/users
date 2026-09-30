import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import {
  DEGREE_LEVEL_OPTIONS,
  POSITION_OPTIONS,
  SCOUT_QUALIFICATION_OPTIONS,
  TEACHING_LICENSE_OPTIONS,
  isExecutive,
  scoutRank,
} from '@/lib/options';
import { yearsSinceThaiDate, yearsSinceWorkStart } from '@/lib/thai';

/**
 * รายงานบุคลากร — every count on the report page, with the names behind each
 * one, worked out from the teachers who are working now (not archived, not
 * resigned). อาจารย์พิเศษ and คนงาน are not in it.
 *
 * Built in one pass over one query: the school has tens of teachers, not
 * thousands, so grouping in SQL would buy nothing and cost a query per section.
 * อายุ and อายุงาน are counted against today, so the report is always current.
 */

export interface ReportPerson {
  id: number;
  code: string;
  name: string;
  /** A short detail beside the name — the degree, the อายุงาน, the ตำแหน่ง. */
  note?: string;
}

export interface ReportBucket {
  label: string;
  people: ReportPerson[];
  /** Buckets that mean "not filled in" — drawn muted, listed so they can be chased. */
  missing?: boolean;
}

export interface StaffReport {
  asOf: string;
  total: number;
  executives: number;
  teachersOnly: number;
  gender: ReportBucket[];
  positions: ReportBucket[];
  subjectGroups: ReportBucket[];
  tenure: ReportBucket[];
  age: ReportBucket[];
  education: ReportBucket[];
  license: ReportBucket[];
  scoutHighest: ReportBucket[];
  scoutHeld: ReportBucket[];
  completeness: ReportBucket[];
}

const MISSING = 'ยังไม่กรอก';

/** Buckets in a fixed order; a person lands in exactly one (or none). */
function bucketer(order: readonly string[], missingLabels: readonly string[] = [MISSING]) {
  const map = new Map<string, ReportPerson[]>(order.map((l) => [l, []]));
  return {
    add(label: string, p: ReportPerson) {
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(p);
    },
    list(keepEmpty = true): ReportBucket[] {
      return [...map.entries()]
        .filter(([, people]) => keepEmpty || people.length > 0)
        .map(([label, people]) => ({
          label,
          people: sortPeople(people),
          ...(missingLabels.includes(label) ? { missing: true } : {}),
        }));
    },
  };
}

const collator = new Intl.Collator('th');
function sortPeople(people: ReportPerson[]): ReportPerson[] {
  return [...people].sort((a, b) => collator.compare(a.name, b.name));
}

function tenureLabel(years: number | null): string {
  if (years === null) return MISSING;
  if (years < 1) return 'น้อยกว่า 1 ปี';
  if (years <= 5) return '1–5 ปี';
  if (years <= 10) return '6–10 ปี';
  if (years <= 20) return '11–20 ปี';
  if (years <= 30) return '21–30 ปี';
  return 'มากกว่า 30 ปี';
}
const TENURE_ORDER = ['น้อยกว่า 1 ปี', '1–5 ปี', '6–10 ปี', '11–20 ปี', '21–30 ปี', 'มากกว่า 30 ปี', MISSING];

function ageLabel(years: number | null): string {
  if (years === null) return MISSING;
  if (years < 30) return 'ต่ำกว่า 30 ปี';
  if (years < 40) return '30–39 ปี';
  if (years < 50) return '40–49 ปี';
  if (years < 60) return '50–59 ปี';
  return '60 ปีขึ้นไป';
}
const AGE_ORDER = ['ต่ำกว่า 30 ปี', '30–39 ปี', '40–49 ปี', '50–59 ปี', '60 ปีขึ้นไป', MISSING];

const BELOW_BACHELOR = 'ต่ำกว่าปริญญาตรี';
const EDU_ORDER = ['ปริญญาเอก', 'ปริญญาโท', 'ประกาศนียบัตรบัณฑิต', 'ปริญญาตรี', BELOW_BACHELOR, 'อื่น ๆ', MISSING];
/** ระดับ → rank, highest first, as DEGREE_LEVEL_OPTIONS lists them. */
const LEVEL_RANK = new Map<string, number>(DEGREE_LEVEL_OPTIONS.map((l, i) => [l, i]));
const BACHELOR_RANK = LEVEL_RANK.get('ปริญญาตรี')!;

const SCOUT_NONE = 'ยังไม่มี / ยังไม่กรอก';
const SCOUT_OTHER = 'วุฒิอื่น (ไม่อยู่ในรายการ)';

/** The fields the report reads, per teacher — what buildStaffReport selects. */
export interface ReportTeacherRow {
  id: number;
  teacherCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  position: string | null;
  subjectGroup: string | null;
  gender: string | null;
  birthDate: string | null;
  workStart: string | null;
  teachingLicenseSource: string | null;
  educations: { degreeLevel: string | null; degreeName: string | null; major: string | null }[];
  scoutQualifications: { qualification: string | null }[];
}

export async function buildStaffReport(): Promise<StaffReport> {
  const rows = await db.query.teachers.findMany({
    where: and(eq(teachers.isArchived, false), eq(teachers.employmentStatus, 'active')),
    columns: {
      id: true, teacherCode: true, prefix: true, firstName: true, lastName: true,
      position: true, subjectGroup: true, gender: true, birthDate: true,
      workStart: true, teachingLicenseSource: true,
    },
    with: {
      educations: { columns: { degreeLevel: true, degreeName: true, major: true, institution: true } },
      scoutQualifications: { columns: { qualification: true } },
    },
  });
  return computeStaffReport(rows);
}

/** The whole report from already-loaded rows — pure, so it can be checked without a database. */
export function computeStaffReport(rows: ReportTeacherRow[]): StaffReport {

  const gender = bucketer(['ชาย', 'หญิง', MISSING]);
  const positions = bucketer([...POSITION_OPTIONS]);
  const subjects = bucketer([], ['ไม่ระบุกลุ่มสาระ']);
  const tenure = bucketer(TENURE_ORDER);
  const age = bucketer(AGE_ORDER);
  const education = bucketer(EDU_ORDER);
  const license = bucketer([...TEACHING_LICENSE_OPTIONS, 'อื่น ๆ', MISSING]);
  const scoutHighest = bucketer([...SCOUT_QUALIFICATION_OPTIONS, SCOUT_OTHER, SCOUT_NONE], [SCOUT_NONE]);
  const scoutHeld = bucketer([...SCOUT_QUALIFICATION_OPTIONS]);
  const gaps = {
    position: [] as ReportPerson[],
    subjectGroup: [] as ReportPerson[],
    birthDate: [] as ReportPerson[],
    workStart: [] as ReportPerson[],
    education: [] as ReportPerson[],
    license: [] as ReportPerson[],
    scout: [] as ReportPerson[],
  };
  let executives = 0;

  for (const t of rows) {
    const base: ReportPerson = {
      id: t.id,
      code: t.teacherCode,
      name: `${t.prefix ?? ''}${t.firstName} ${t.lastName}`.trim(),
    };
    const pos = (t.position ?? '').trim();
    const exec = isExecutive(pos);
    if (exec) executives++;

    // เพศ
    const g = (t.gender ?? '').trim();
    gender.add(g === 'ชาย' || g === 'หญิง' ? g : g ? g : MISSING, base);

    // ตำแหน่ง — blank reads as ครู, but is also listed as a gap for the office.
    positions.add(pos || 'ครู', { ...base, note: t.subjectGroup ?? undefined });
    if (!pos) gaps.position.push(base);

    // กลุ่มสาระ
    const sg = (t.subjectGroup ?? '').trim();
    subjects.add(sg || 'ไม่ระบุกลุ่มสาระ', { ...base, note: exec ? pos : undefined });
    if (!sg) gaps.subjectGroup.push(base);

    // อายุงาน / อายุ
    const ty = yearsSinceWorkStart(t.workStart);
    tenure.add(tenureLabel(ty), { ...base, note: ty === null ? undefined : `${ty} ปี` });
    if (ty === null) gaps.workStart.push(base);
    const ay = yearsSinceThaiDate(t.birthDate);
    age.add(ageLabel(ay), { ...base, note: ay === null ? undefined : `${ay} ปี` });
    if (ay === null) gaps.birthDate.push(base);

    // วุฒิการศึกษาสูงสุด
    const ranked = t.educations
      .map((e) => ({ e, r: LEVEL_RANK.get((e.degreeLevel ?? '').trim()) }))
      .sort((a, b) => (a.r ?? 99) - (b.r ?? 99));
    const top = ranked[0];
    if (!top) {
      education.add(MISSING, base);
      gaps.education.push(base);
    } else {
      const note = [top.e.degreeName, top.e.major && `วิชาเอก${top.e.major}`].filter(Boolean).join(' · ') || undefined;
      const label = top.r === undefined
        ? 'อื่น ๆ'
        : top.r > BACHELOR_RANK ? BELOW_BACHELOR : DEGREE_LEVEL_OPTIONS[top.r];
      education.add(label, { ...base, note });
    }

    // ใบประกอบวิชาชีพครู
    const lic = (t.teachingLicenseSource ?? '').trim();
    if (!lic) { license.add(MISSING, base); gaps.license.push(base); }
    else if ((TEACHING_LICENSE_OPTIONS as readonly string[]).includes(lic)) license.add(lic, base);
    else license.add('อื่น ๆ', { ...base, note: lic });

    // วุฒิลูกเสือ — each warrant held, and the highest one.
    const ranks = t.scoutQualifications
      .map((q) => scoutRank(q.qualification))
      .filter((r, i, all) => all.indexOf(r) === i);
    const known = ranks.filter((r) => r < SCOUT_QUALIFICATION_OPTIONS.length);
    for (const r of known) scoutHeld.add(SCOUT_QUALIFICATION_OPTIONS[r], base);
    if (known.length) scoutHighest.add(SCOUT_QUALIFICATION_OPTIONS[Math.max(...known)], base);
    else if (ranks.length) scoutHighest.add(SCOUT_OTHER, base);
    else { scoutHighest.add(SCOUT_NONE, base); gaps.scout.push(base); }
  }

  const subjectList = subjects.list(false).sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? 1 : -1;
    return b.people.length - a.people.length || collator.compare(a.label, b.label);
  });

  const completeness: ReportBucket[] = [
    { label: 'ตำแหน่ง (นับเป็นครู)', people: sortPeople(gaps.position), missing: true },
    { label: 'กลุ่มสาระ', people: sortPeople(gaps.subjectGroup), missing: true },
    { label: 'วันเดือนปีเกิด', people: sortPeople(gaps.birthDate), missing: true },
    { label: 'เดือน/ปีที่เข้าทำงาน', people: sortPeople(gaps.workStart), missing: true },
    { label: 'วุฒิการศึกษา', people: sortPeople(gaps.education), missing: true },
    { label: 'ใบประกอบวิชาชีพครู', people: sortPeople(gaps.license), missing: true },
    { label: 'วุฒิลูกเสือ', people: sortPeople(gaps.scout), missing: true },
  ];

  return {
    asOf: new Date().toISOString(),
    total: rows.length,
    executives,
    teachersOnly: rows.length - executives,
    gender: gender.list(false),
    positions: positions.list(false),
    subjectGroups: subjectList,
    tenure: tenure.list(),
    age: age.list(),
    education: education.list().filter((b) => b.people.length || b.label !== 'อื่น ๆ'),
    license: license.list().filter((b) => b.people.length || b.label !== 'อื่น ๆ'),
    scoutHighest: scoutHighest.list().filter((b) => b.people.length || b.label !== SCOUT_OTHER),
    scoutHeld: scoutHeld.list(),
    completeness,
  };
}

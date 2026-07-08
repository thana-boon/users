import ExcelJS from 'exceljs';
import { decrypt } from '@/lib/crypto';

/**
 * Excel round-trip. The export reproduces the exact 157-column layout of the
 * source students.xlsx so a file exported here can be edited and re-imported,
 * and so it opens cleanly in the tools the school already uses.
 *
 * Header order is the single source of truth for both export (build row) and
 * the human-facing template.
 */

// Full 157-column header row, in source order.
export const STUDENT_COLUMNS: string[] = [
  'ลำดับ', 'ชั้น', 'ห้อง', 'เลขที่', 'email', 'email-password', 'รหัสบัตรประชาชน',
  'รหัสนักเรียน', 'วันที่เข้าเรียน', 'เพศ', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น',
  'ชื่อ(อังกฤษ)', 'นามสกุล(อังกฤษ)', 'ชื่อเล่น(อังกฤษ)', 'วัน/เดือน/ปีเกิด',
  'ศาสนา', 'สัญชาติ', 'เชื้อชาติ', 'มีพี่น้องทั้งหมด', 'เป็นบุตรคนที่',
  'พี่/น้องเรียนในโรงเรียนนี้', 'เบอร์โทรศัพท์', 'รหัสประจำบ้าน', 'บ้านเลขที่',
  'ซอย', 'หมู่', 'ถนน', 'แขวง/ตำบล', 'เขต/อำเภอ', 'จังหวัด', 'รหัสไปรษณีย์',
  'เบอร์โทรศัพท์บ้าน', 'สถานที่เกิดระบุที่เกิด(รพ.)', 'สถานที่เกิดแขวง/ตำบล',
  'สถานที่เกิดเขต/อำเภอ', 'สถานที่เกิดจังหวัด', 'บ้านเลขที่ปัจจุบัน', 'หมู่', 'ซอย',
  'ถนน', 'ตำบล', 'อำเภอ', 'จังหวัด', 'รหัสไปรษณีย์', 'เบอร์โทรศัพท์บ้าน', 'อาศัยอยู่กับ',
  'นามสกุล', 'ลักษณะบ้าน', 'อีเมล์', 'เบอร์ติดต่อฉุกเฉิน', 'เพื่อนใกล้บ้าน', 'นามสกุล',
  'เบอร์โทรศัพท์เพื่อน', 'สถานศึกษาเดิม', 'ตำบล', 'อำเภอ', 'จังหวัด', 'วุฒิการศึกษา',
  'GPA', 'เหตุที่ย้าย', 'บ้านเกิดเลขที่', 'หมู่', 'ซอย', 'ถนน', 'ตำบล', 'อำเภอ', 'จังหวัด',
  'รหัสไปรษณีย์', 'เบอร์โทรศัพท์', 'ความสัมพันธ์', 'คำนำหน้า', 'ชื่อผู้ปกครอง', 'นามสกุล',
  'ชื่อผู้ปกครอง(อังกฤษ)', 'นามสกุล(อังกฤษ)', 'วัน/เดือน/ปีเกิด', 'ศาสนา', 'สัญชาติ',
  'เชื้อชาติ', 'บ้านเลขที่', 'หมู่', 'ซอย', 'ถนน', 'ตำบล', 'อำเภอ', 'จังหวัด', 'รหัสไปรษณีย์',
  'เบอร์บ้าน', 'เบอร์มือถือ', 'เบอร์ที่ทำงาน', 'สถานะครอบครัว', 'วุฒิการศึกษา', 'อาชีพผู้ปกครอง',
  'สถานที่ทำงาน', 'รายได้ต่อเดือน', 'รายได้ต่อปี', 'คำนำหน้า', 'ชื่อบิดา', 'นามสกุล',
  'ชื่อบิดา(อังกฤษ)', 'นามสกุล(อังกฤษ)', 'วัน/เดือน/ปีเกิด', 'ศาสนา', 'สัญชาติ', 'เชื้อชาติ',
  'บ้านเลขที่', 'หมู่', 'ซอย', 'ถนน', 'ตำบล', 'อำเภอ', 'จังหวัด', 'รหัสไปรษณีย์', 'เบอร์บ้าน',
  'เบอร์มือถือ', 'เบอร์ที่ทำงาน', 'วุฒิการศึกษา', 'อาชีพบิดา', 'สถานที่ทำงาน', 'รายได้ต่อเดือน',
  'รายได้ต่อปี', 'คำนำหน้า', 'ชื่อมารดา', 'นามสกุล', 'ชื่อมารดา(อังกฤษ)', 'นามสกุล(อังกฤษ)',
  'วัน/เดือน/ปีเกิด', 'ศาสนา', 'สัญชาติ', 'เชื้อชาติ', 'บ้านเลขที่', 'หมู่', 'ซอย', 'ถนน',
  'ตำบล', 'อำเภอ', 'จังหวัด', 'รหัสไปรษณีย์', 'เบอร์บ้าน', 'เบอร์มือถือ', 'เบอร์ที่ทำงาน',
  'วุฒิการศึกษา', 'อาชีพมารดา', 'สถานที่ทำงาน', 'รายได้ต่อเดือน', 'รายได้ต่อปี', 'น้ำหนัก',
  'ส่วนสูง', 'กรุ๊ปเลือด', 'แพ้อาหาร', 'แพ้ยา', 'แพ้อื่นๆ', 'โรคประจำตัว', 'โรคร้ายแรง',
];

export const TEACHER_COLUMNS: string[] = [
  'ลำดับ', 'รหัสบัตรประชาชน', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'รหัสครูผู้สอน',
  'Username', 'Password', 'Email', 'ชั้นที่สอน', 'กลุ่มสาระที่สอน',
];

const SKDW_PURPLE = 'FF5B2D8E';
const SKDW_GOLD = 'FFF5C518';

function styleHeader(ws: ExcelJS.Worksheet, gold = false) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: gold ? 'FF1A1A2E' : 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: gold ? SKDW_GOLD : SKDW_PURPLE },
  };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 22;
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

// -- Templates (header only) ---------------------------------------
export async function buildStudentTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('นักเรียน');
  ws.columns = STUDENT_COLUMNS.map((h) => ({ header: h, key: h, width: 18 }));
  styleHeader(ws);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return toBuffer(wb);
}

export async function buildTeacherTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('teachers');
  ws.columns = TEACHER_COLUMNS.map((h) => ({ header: h, key: h, width: 20 }));
  styleHeader(ws, true);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return toBuffer(wb);
}

// -- Exports -------------------------------------------------------
export interface StudentExportRow {
  student: Record<string, unknown> & {
    citizenIdEncrypted: string | null;
    passwordEncrypted: string | null;
  };
  enrollment: { gradeLevel: string | null; classroom: string | null; classNumber: string | null; seqOrder: number | null } | null;
  addresses: Record<string, Record<string, unknown>>;
  previousSchool: Record<string, unknown> | null;
  guardians: Record<string, Record<string, unknown>>;
  health: Record<string, unknown> | null;
}

const val = (v: unknown) => (v === null || v === undefined ? '' : v);

/** Returns the shared guardian column blocks: identity+address (20 cells) and work+income (5 cells). */
function guardianCols(gd: Record<string, unknown> | undefined) {
  const base = [
    val(gd?.prefix), val(gd?.firstName), val(gd?.lastName), val(gd?.firstNameEn),
    val(gd?.lastNameEn), val(gd?.birthDate), val(gd?.religion), val(gd?.nationality),
    val(gd?.ethnicity), val(gd?.houseNo), val(gd?.moo), val(gd?.soi), val(gd?.road),
    val(gd?.subDistrict), val(gd?.district), val(gd?.province), val(gd?.postalCode),
    val(gd?.homePhone), val(gd?.mobilePhone), val(gd?.workPhone),
  ];
  const tail = [
    val(gd?.education), val(gd?.occupation), val(gd?.workplace),
    val(decrypt((gd?.incomeMonthlyEncrypted as string) ?? null) ?? ''),
    val(decrypt((gd?.incomeYearlyEncrypted as string) ?? null) ?? ''),
  ];
  return { base, tail };
}

/** Build the 157-cell row for one student (decrypts sensitive fields). */
export function studentToRow(x: StudentExportRow): unknown[] {
  const s = x.student;
  const en = x.enrollment;
  const hh = x.addresses.household ?? {};
  const bp = x.addresses.birth_place ?? {};
  const cu = x.addresses.current ?? {};
  const ht = x.addresses.hometown ?? {};
  const ps = x.previousSchool ?? {};
  const gd = x.guardians.guardian;
  const fa = x.guardians.father;
  const mo = x.guardians.mother;
  const he = x.health ?? {};

  const gdCols = guardianCols(gd);
  const faCols = guardianCols(fa);
  const moCols = guardianCols(mo);

  return [
    val(en?.seqOrder), val(en?.gradeLevel), val(en?.classroom), val(en?.classNumber),
    val(s.email), val(decrypt(s.passwordEncrypted) ?? ''), val(decrypt(s.citizenIdEncrypted) ?? ''),
    val(s.studentCode), val(s.admissionDate), val(s.gender), val(s.prefix), val(s.firstName),
    val(s.lastName), val(s.nickname), val(s.firstNameEn), val(s.lastNameEn), val(s.nicknameEn),
    val(s.birthDate), val(s.religion), val(s.nationality), val(s.ethnicity),
    val(s.siblingsTotal), val(s.siblingOrder), val(s.hasSiblingInSchool), val(s.phone),
    // household 25-34
    val(hh.houseRegCode), val(hh.houseNo), val(hh.soi), val(hh.moo), val(hh.road),
    val(hh.subDistrict), val(hh.district), val(hh.province), val(hh.postalCode), val(hh.phone),
    // birth place 35-38
    val(bp.hospitalName), val(bp.subDistrict), val(bp.district), val(bp.province),
    // current 39-55
    val(cu.houseNo), val(cu.moo), val(cu.soi), val(cu.road), val(cu.subDistrict),
    val(cu.district), val(cu.province), val(cu.postalCode), val(cu.phone), val(cu.livingWith),
    val(cu.livingWithLastname), val(cu.houseType), val(cu.emergencyEmail), val(cu.emergencyPhone),
    val(cu.nearbyFriendName), val(cu.nearbyFriendLastname), val(cu.nearbyFriendPhone),
    // previous school 56-62
    val(ps.schoolName), val(ps.subDistrict), val(ps.district), val(ps.province),
    val(ps.qualification), val(ps.gpa), val(ps.transferReason),
    // hometown 63-71
    val(ht.houseNo), val(ht.moo), val(ht.soi), val(ht.road), val(ht.subDistrict),
    val(ht.district), val(ht.province), val(ht.postalCode), val(ht.phone),
    // guardian 72-98
    val(gd?.relationship), ...gdCols.base, val(gd?.familyStatus), ...gdCols.tail,
    // father 99-123
    ...faCols.base, ...faCols.tail,
    // mother 124-148
    ...moCols.base, ...moCols.tail,
    // health 149-156
    val(he.weight), val(he.height), val(he.bloodType), val(he.foodAllergy),
    val(he.drugAllergy), val(he.otherAllergy), val(he.chronicDisease), val(he.seriousDisease),
  ];
}

export async function buildStudentExport(rows: StudentExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('นักเรียน');
  ws.addRow(STUDENT_COLUMNS);
  for (const r of rows) ws.addRow(studentToRow(r));
  styleHeader(ws);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return toBuffer(wb);
}

export interface TeacherExportRow {
  teacherCode: string;
  citizenIdEncrypted: string | null;
  prefix: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  passwordEncrypted: string | null;
  gradeTaught: string | null;
  subjectGroup: string | null;
}

export async function buildTeacherExport(rows: TeacherExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('teachers');
  ws.addRow(TEACHER_COLUMNS);
  rows.forEach((t, i) => {
    ws.addRow([
      i + 1,
      decrypt(t.citizenIdEncrypted) ?? '',
      val(t.prefix),
      t.firstName,
      t.lastName,
      t.teacherCode,
      t.teacherCode, // Username = teacher_code
      decrypt(t.passwordEncrypted) ?? '',
      val(t.email),
      val(t.gradeTaught),
      val(t.subjectGroup),
    ]);
  });
  styleHeader(ws, true);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return toBuffer(wb);
}

// -- Import (read rows back to arrays) -----------------------------
export async function readSheetRows(buf: Buffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs typings predate the Buffer<ArrayBufferLike> generic; cast is safe.
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const arr: unknown[] = [];
    // exceljs is 1-indexed and pads; normalize to 0-index dense array
    const values = row.values as unknown[]; // index 0 unused
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      arr[i - 1] = v && typeof v === 'object' && 'text' in (v as object)
        ? (v as { text: string }).text
        : v ?? null;
    }
    out.push(arr);
  });
  return out;
}

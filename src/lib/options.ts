/**
 * Canonical picklists for the free-text demographic fields (เพศ / ศาสนา /
 * สัญชาติ / เชื้อชาติ) and for the exit workflow (ประเภท + เหตุผลการจำหน่าย).
 *
 * These columns are plain varchar — typing them by hand produced variants like
 * "พุทธิ" / "พุทธศาสนา" / "ศาสนาพุทธ" that break grouping and reports. The UI
 * pairs each list with <Combo> (searchable, still accepts free text so rare
 * cases are not blocked), and `normalizeChoice` snaps the common misspellings
 * and synonyms back onto the canonical spelling on blur and on Excel import.
 *
 * Exit types/reasons follow ระเบียบกระทรวงศึกษาธิการ ว่าด้วยทะเบียนนักเรียน พ.ศ. 2535
 * (5 สาเหตุการจำหน่าย) plus the DMC "สาเหตุการออกกลางคัน" picklist.
 */

export const GENDER_OPTIONS = ['ชาย', 'หญิง'] as const;

export const STUDENT_PREFIX_OPTIONS = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว'] as const;

export const STAFF_PREFIX_OPTIONS = [
  'นาย', 'นาง', 'นางสาว', 'ว่าที่ ร.ต.', 'ว่าที่ ร.ต.หญิง',
  'ดร.', 'ผศ.', 'รศ.', 'พระ',
] as const;

export const RELIGION_OPTIONS = [
  'พุทธ', 'อิสลาม', 'คริสต์', 'ฮินดู', 'ซิกข์', 'ไม่นับถือศาสนา',
] as const;

export const NATIONALITY_OPTIONS = [
  'ไทย', 'ลาว', 'พม่า', 'กัมพูชา', 'เวียดนาม', 'จีน', 'มาเลเซีย', 'อินเดีย',
  'ไม่ปรากฏสัญชาติ',
] as const;

export const ETHNICITY_OPTIONS = [
  'ไทย', 'ลาว', 'พม่า', 'กัมพูชา', 'เวียดนาม', 'จีน', 'มลายู', 'อินเดีย',
  'ไทใหญ่', 'กะเหรี่ยง', 'ม้ง', 'อาข่า', 'ลาหู่', 'เมี่ยน', 'ลีซู',
] as const;

/**
 * ประเภทการจำหน่าย — every one of these means the student has left the roll.
 * `พักการเรียน` is deliberately NOT here: a suspended student is still enrolled,
 * so it lives in its own workflow (/users/leaves, table `student_leaves`).
 */
export const EXIT_TYPE_OPTIONS = [
  'ลาออก',
  'ย้ายสถานศึกษา',
  'ศึกษาต่อสถานศึกษาอื่น',
  'เสียชีวิต',
  'นักเรียนไปโครงการ',
  'จำหน่าย',
  'อื่น ๆ',
] as const;

/** ประเภทการพักการเรียน — mirrors LEAVE_TYPES in the schema. */
export const LEAVE_TYPE_OPTIONS = [
  'พักการเรียน',
  'ลาพักรักษาตัว',
  'ถูกสั่งพักการเรียน',
  'ลาไปต่างประเทศ',
  'อื่น ๆ',
] as const;

/** เหตุผลการพักการเรียน — a leave is temporary, so these differ from the exit list. */
export const LEAVE_REASON_OPTIONS = [
  'เจ็บป่วย / รักษาตัว',
  'อุบัติเหตุ',
  'ปัญหาสุขภาพจิต',
  'ติดตามผู้ปกครองไปต่างจังหวัด',
  'ติดตามผู้ปกครองไปต่างประเทศ',
  'ปัญหาครอบครัว',
  'ปัญหาด้านการเงิน',
  'ตั้งครรภ์',
  'ถูกลงโทษทางวินัย',
  'ต้องคดี / อยู่ระหว่างดำเนินคดี',
  'เข้าร่วมโครงการแลกเปลี่ยน',
  'อื่น ๆ',
] as const;

/**
 * เหตุผลการจำหน่าย/ออกกลางคัน — the four statutory causes plus the DMC dropout
 * causes. Free text is still allowed for anything not covered here.
 */
export const EXIT_REASON_OPTIONS = [
  'ศึกษาต่อสถานศึกษาอื่น',
  'ย้ายตามผู้ปกครอง',
  'เสียชีวิต',
  'หยุดเรียนติดต่อกันเป็นเวลานาน ไม่มีตัวตนในพื้นที่',
  'อายุพ้นเกณฑ์การศึกษาภาคบังคับ',
  'อพยพตามผู้ปกครอง',
  'ฐานะยากจน',
  'มีปัญหาครอบครัว',
  'มีปัญหาในการปรับตัว',
  'เจ็บป่วย / อุบัติเหตุ',
  'หาเลี้ยงครอบครัว',
  'ไปประกอบอาชีพ',
  'สมรสแล้ว',
  'ต้องคดี / ถูกจับ',
  'จบการศึกษาภาคบังคับ ไม่ประสงค์เรียนต่อ',
  'ไม่ทราบสาเหตุ',
  'อื่น ๆ',
] as const;

/** เหตุผลการลาออก/พ้นสภาพของครูและคนงาน. */
export const STAFF_EXIT_REASON_OPTIONS = [
  'ลาออก',
  'ย้ายสถานศึกษา',
  'โอนย้ายหน่วยงาน',
  'เกษียณอายุราชการ',
  'หมดสัญญาจ้าง',
  'เสียชีวิต',
  'ลาออกเพื่อศึกษาต่อ',
  'อื่น ๆ',
] as const;

/** Lowercase + drop whitespace and the punctuation Thai typists vary on. */
function foldKey(v: string): string {
  return v.toLowerCase().replace(/[\s.\-–—_/()]/g, '').replace(/[์ๆฯ]+$/g, '');
}

/**
 * Misspellings / synonyms → canonical value. Written in natural spelling and
 * folded at load, so "ศาสนา พุทธ", "ศาสนาพุทธ" and "ศาสนาพุทธ์" all collapse
 * onto one entry.
 */
const ALIASES = new Map<string, string>(
  Object.entries({
    // ศาสนา
    พุทธิ: 'พุทธ', พุทธะ: 'พุทธ', พุท: 'พุทธ', พุธ: 'พุทธ', พุทท: 'พุทธ',
    ศาสนาพุทธ: 'พุทธ', พุทธศาสนา: 'พุทธ', buddhism: 'พุทธ', buddhist: 'พุทธ',
    อิสลามิก: 'อิสลาม', อิสราม: 'อิสลาม', อิสลาห์: 'อิสลาม', มุสลิม: 'อิสลาม',
    ศาสนาอิสลาม: 'อิสลาม', islam: 'อิสลาม', muslim: 'อิสลาม',
    คริส: 'คริสต์', คริสต์ศาสนา: 'คริสต์', ศาสนาคริสต์: 'คริสต์',
    คริสเตียน: 'คริสต์', คาทอลิก: 'คริสต์', โปรเตสแตนต์: 'คริสต์',
    christ: 'คริสต์', christian: 'คริสต์', catholic: 'คริสต์',
    'พราหมณ์-ฮินดู': 'ฮินดู', พราหมณ์: 'ฮินดู', hindu: 'ฮินดู',
    ซิก: 'ซิกข์', ซิกซ์: 'ซิกข์', ซิกส์: 'ซิกข์', sikh: 'ซิกข์',
    ไม่มีศาสนา: 'ไม่นับถือศาสนา', ไม่นับถือ: 'ไม่นับถือศาสนา', none: 'ไม่นับถือศาสนา',
    // เพศ
    ช: 'ชาย', ญ: 'หญิง', ชายไทย: 'ชาย', หญิงไทย: 'หญิง',
    m: 'ชาย', male: 'ชาย', f: 'หญิง', female: 'หญิง',
    // สัญชาติ / เชื้อชาติ
    ไท: 'ไทย', ไทยฯ: 'ไทย', thai: 'ไทย', thailand: 'ไทย',
    เมียนมา: 'พม่า', เมียนมาร์: 'พม่า', myanmar: 'พม่า', burmese: 'พม่า',
    lao: 'ลาว', laos: 'ลาว',
    เขมร: 'กัมพูชา', cambodia: 'กัมพูชา', khmer: 'กัมพูชา',
    chinese: 'จีน', china: 'จีน',
    ไม่มีสัญชาติ: 'ไม่ปรากฏสัญชาติ', ไร้สัญชาติ: 'ไม่ปรากฏสัญชาติ',
  }).map(([k, v]) => [foldKey(k), v]),
);

/**
 * Snap a typed value onto the canonical spelling when it is an obvious variant
 * of a known option; otherwise return it trimmed and untouched (free text is a
 * supported answer, not an error).
 */
export function normalizeChoice(
  raw: string | null | undefined,
  options: readonly string[],
): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim().replace(/\s+/g, ' ');
  if (trimmed === '') return null;

  const key = foldKey(trimmed);
  const exact = options.find((o) => foldKey(o) === key);
  if (exact) return exact;

  const alias = ALIASES.get(key);
  // Only accept an alias that belongs to this field's own list, so "ไทย" as a
  // religion is not silently rewritten by the nationality entry.
  if (alias && options.includes(alias)) return alias;

  return trimmed;
}

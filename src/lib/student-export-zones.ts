/**
 * โซนข้อมูลของไฟล์ส่งออกนักเรียน — the 157 columns of STUDENT_COLUMNS cut into
 * the blocks a secretary thinks in, so the export dialog can offer them as
 * checkboxes. Client-safe (no exceljs/crypto) so the dialog can import it.
 *
 * Indexes are 0-based positions in STUDENT_COLUMNS. KEY columns are in every
 * export: a sheet without ชั้น/ห้อง/เลขที่/รหัส/ชื่อ is not a class list.
 */
export const STUDENT_KEY_COLUMNS = [0, 1, 2, 3, 7, 10, 11, 12];

const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export interface StudentExportZone {
  key: string;
  label: string;
  hint?: string;
  cols: number[];
}

export const STUDENT_EXPORT_ZONES: StudentExportZone[] = [
  { key: 'personal', label: 'ข้อมูลส่วนตัว', hint: 'วันที่เข้าเรียน เพศ ชื่อเล่น ชื่ออังกฤษ วันเกิด ศาสนา พี่น้อง เบอร์โทร', cols: [8, 9, ...span(13, 24)] },
  { key: 'account', label: 'บัญชีและเลขบัตรประชาชน', hint: 'email, email-password, รหัสบัตรประชาชน', cols: [4, 5, 6] },
  { key: 'household', label: 'ที่อยู่ตามทะเบียนบ้าน', cols: span(25, 34) },
  { key: 'birthPlace', label: 'สถานที่เกิด', cols: span(35, 38) },
  { key: 'current', label: 'ที่อยู่ปัจจุบันและผู้ติดต่อฉุกเฉิน', cols: span(39, 55) },
  { key: 'previousSchool', label: 'สถานศึกษาเดิม', cols: span(56, 62) },
  { key: 'hometown', label: 'ภูมิลำเนา (บ้านเกิด)', cols: span(63, 71) },
  { key: 'guardian', label: 'ผู้ปกครอง', cols: span(72, 98) },
  { key: 'father', label: 'บิดา', cols: span(99, 123) },
  { key: 'mother', label: 'มารดา', cols: span(124, 148) },
  { key: 'health', label: 'สุขภาพ', cols: span(149, 156) },
];

export const ALL_STUDENT_ZONE_KEYS = STUDENT_EXPORT_ZONES.map((z) => z.key);

/** Column positions to keep for the chosen zones, in sheet order. */
export function studentExportColumns(zoneKeys: readonly string[]): number[] {
  const keep = new Set(STUDENT_KEY_COLUMNS);
  for (const z of STUDENT_EXPORT_ZONES) if (zoneKeys.includes(z.key)) z.cols.forEach((c) => keep.add(c));
  return [...keep].sort((a, b) => a - b);
}

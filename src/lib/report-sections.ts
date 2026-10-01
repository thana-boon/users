import type { ReportBucket, StaffReport } from '@/lib/services/staff-report';

/**
 * The parts of รายงานบุคลากร a person can pick for export, in report order —
 * one list for the screen, the PDF and the Excel file, so the three always
 * offer and title the same sections. No server imports: the export dialog
 * reads it in the browser.
 */

export const SCHOOL_NAME_TH = 'โรงเรียนสุคนธีรวิทย์';
export const SCHOOL_NAME_EN = 'Sukhondheerawidh School';

type BucketField = {
  [K in keyof StaffReport]: StaffReport[K] extends ReportBucket[] ? K : never;
}[keyof StaffReport];

export interface ReportSectionDef {
  key: string;
  title: string;
  /** Short name for the picker and the Excel sheet tab (≤ 31 chars). */
  short: string;
  hint?: string;
  field: BucketField;
  /** Counts of people who have NOT filled something in. */
  gaps?: boolean;
}

/** ภาพรวม (the totals) is always first and is not a bucket list. */
export const OVERVIEW_KEY = 'overview';

export const STAFF_REPORT_SECTIONS: ReportSectionDef[] = [
  {
    key: 'positions', field: 'positions', short: 'ตำแหน่ง',
    title: 'ผู้บริหารและครู แยกตามตำแหน่ง',
    hint: 'ผู้บริหาร = ผู้รับใบอนุญาต ผู้จัดการ ผู้อำนวยการ รอง และผู้ช่วยผู้อำนวยการ · ยังไม่ระบุตำแหน่งนับเป็นครู',
  },
  { key: 'subjects', field: 'subjectGroups', short: 'กลุ่มสาระ', title: 'ครูแยกตามกลุ่มสาระ' },
  { key: 'tenure', field: 'tenure', short: 'อายุงาน', title: 'แยกตามอายุงาน', hint: 'นับจากเดือน/ปีที่เข้าทำงาน ถึงวันที่ออกรายงาน' },
  { key: 'age', field: 'age', short: 'อายุ', title: 'แยกตามอายุ', hint: 'นับจากวันเกิด ถึงวันที่ออกรายงาน' },
  { key: 'education', field: 'education', short: 'วุฒิการศึกษา', title: 'แยกตามวุฒิการศึกษาสูงสุด', hint: 'วุฒิสูงสุดของแต่ละคน คนละ 1 ครั้ง' },
  { key: 'license', field: 'license', short: 'ใบประกอบวิชาชีพ', title: 'ใบประกอบวิชาชีพครู ได้มาจาก' },
  {
    key: 'scoutHighest', field: 'scoutHighest', short: 'ลูกเสือ (วุฒิสูงสุด)',
    title: 'วุฒิลูกเสือ — วุฒิสูงสุดของแต่ละคน', hint: 'B.T.C. → A.T.C. → W.B. → A.L.T.C. → A.L.T. → L.T.C. → L.T. · คนละ 1 ครั้ง',
  },
  {
    key: 'scoutHeld', field: 'scoutHeld', short: 'ลูกเสือ (แต่ละวุฒิ)',
    title: 'วุฒิลูกเสือ — จำนวนผู้ที่ได้รับแต่ละวุฒิ', hint: 'คนที่มีหลายวุฒิ นับในทุกวุฒิที่ได้รับ',
  },
  {
    key: 'gaps', field: 'completeness', short: 'ข้อมูลที่ยังไม่กรอก', gaps: true,
    title: 'ข้อมูลที่ยังไม่กรอก', hint: 'จำนวนครูที่ยังไม่ได้กรอกแต่ละหัวข้อ',
  },
];

export const ALL_SECTION_KEYS = [OVERVIEW_KEY, ...STAFF_REPORT_SECTIONS.map((s) => s.key)];

/** "1 ตุลาคม 2569 เวลา 09:41 น." in Bangkok time — the stamp on every export. */
export function thaiTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' });
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  return `${date} เวลา ${time} น.`;
}

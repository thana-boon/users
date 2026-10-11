/**
 * The fields ติดตามการกรอกข้อมูล checks, and the report's shape. No server
 * imports, so the page can read them in the browser; the service
 * (lib/services/staff-completion.ts) fills them in.
 */

export const COMPLETION_FIELDS = [
  { key: 'phone', label: 'เบอร์โทร', who: 'teacher' },
  { key: 'birthDate', label: 'วันเกิด', who: 'teacher' },
  { key: 'workStart', label: 'เดือน/ปีที่เข้าทำงาน', who: 'teacher' },
  { key: 'emergency', label: 'ผู้ติดต่อฉุกเฉิน', who: 'teacher' },
  { key: 'address', label: 'ที่อยู่ปัจจุบัน', who: 'teacher' },
  { key: 'education', label: 'วุฒิการศึกษา', who: 'teacher' },
  { key: 'license', label: 'ใบประกอบวิชาชีพครู', who: 'teacher' },
  { key: 'scout', label: 'วุฒิลูกเสือ', who: 'teacher' },
  { key: 'position', label: 'ตำแหน่ง', who: 'office' },
  { key: 'subjectGroup', label: 'กลุ่มสาระ', who: 'office' },
] as const;

export type CompletionKey = (typeof COMPLETION_FIELDS)[number]['key'];

export interface CompletionPerson {
  id: number;
  code: string;
  name: string;
  subjectGroup: string | null;
  /** Empty fields the teacher fills in themselves. */
  missing: CompletionKey[];
  /** Empty fields only the office can fill in. */
  officeMissing: CompletionKey[];
  /** Share of the teacher's own fields that are filled, 0–1. */
  ratio: number;
}

export interface CompletionReport {
  asOf: string;
  total: number;
  /** Teachers with every one of their own fields filled. */
  complete: number;
  /** Filled teacher-fields over all teacher-fields, 0–1. */
  overall: number;
  fields: { key: CompletionKey; label: string; who: 'teacher' | 'office'; missing: number }[];
  groups: { label: string; total: number; complete: number; ratio: number }[];
  people: CompletionPerson[];
}

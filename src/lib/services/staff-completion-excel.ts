import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { COMPLETION_FIELDS, type CompletionPerson, type CompletionReport } from '@/lib/completion-fields';
import { SCHOOL_NAME_EN, SCHOOL_NAME_TH, thaiTimestamp } from '@/lib/report-sections';

/**
 * ใบติดตามการกรอกข้อมูล as .xlsx: one row per teacher (the people passed in —
 * already filtered by the caller), a ✗ under every field still empty, and a
 * second sheet of progress by กลุ่มสาระ. Filters on the header, so the office
 * can narrow it to one field or one group themselves.
 */

const PURPLE = 'FF5B2D8E';
const MUTED = 'FF6B6478';
const RED = 'FFDC2626';
const FONT = 'TH Sarabun New';
const font = (size = 14, bold = false, color = 'FF1A1625') => ({ name: FONT, size, bold, color: { argb: color } });
const labelOf = (k: string) => COMPLETION_FIELDS.find((f) => f.key === k)?.label ?? k;

export async function buildCompletionWorkbook(report: CompletionReport, people: CompletionPerson[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `SchoolOS — ${SCHOOL_NAME_TH}`;
  const stamp = thaiTimestamp(report.asOf);

  const ws = wb.addWorksheet('ติดตามการกรอก', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
  });
  try {
    const seal = await readFile(path.join(process.cwd(), 'public', 'school-seal.png'));
    const id = wb.addImage({ buffer: seal as unknown as ExcelJS.Buffer, extension: 'png' });
    ws.addImage(id, { tl: { col: 0.15, row: 0.1 }, ext: { width: 44, height: 56 } });
  } catch { /* no seal */ }
  ws.getCell('C1').value = SCHOOL_NAME_TH; ws.getCell('C1').font = font(18, true, PURPLE);
  ws.getCell('C2').value = SCHOOL_NAME_EN; ws.getCell('C2').font = font(12, false, MUTED);
  ws.getCell('C3').value = `ติดตามการกรอกข้อมูลบุคลากร — ครูกรอกครบ ${report.complete} จาก ${report.total} คน (${Math.round(report.overall * 100)}%)`;
  ws.getCell('C3').font = font(15, true);
  ws.getCell('C4').value = `ข้อมูล ณ วันที่ ${stamp} · ✗ = ยังไม่ได้กรอก · ช่องที่มี (แอดมิน) ผู้ดูแลระบบเป็นผู้กรอก`;
  ws.getCell('C4').font = font(12, false, MUTED);

  const fieldCols = COMPLETION_FIELDS.map((f) => (f.who === 'office' ? `${f.label} (แอดมิน)` : f.label));
  const headers = ['ลำดับ', 'รหัสครู', 'ชื่อ-นามสกุล', 'กลุ่มสาระ', 'ครบ (%)', 'ยังขาด (ครูกรอก)', ...fieldCols];
  const head = ws.getRow(6);
  head.values = headers;
  head.font = font(13, true, 'FFFFFFFF');
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 34;
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } }; });
  ws.columns.forEach((c, i) => { c.width = [7, 10, 28, 30, 9, 40][i] ?? 12; });

  people.forEach((p, i) => {
    const row = ws.addRow([
      i + 1, p.code, p.name, p.subjectGroup ?? 'ไม่ระบุ', p.ratio,
      p.missing.length ? p.missing.map(labelOf).join(', ') : 'ครบแล้ว',
      ...COMPLETION_FIELDS.map((f) => ((f.who === 'office' ? p.officeMissing : p.missing).includes(f.key) ? '✗' : '')),
    ]);
    row.font = font(14);
    row.getCell(5).numFmt = '0%';
    row.getCell(6).font = font(14, false, p.missing.length ? RED : 'FF16A34A');
    for (let c = 7; c <= headers.length; c++) {
      row.getCell(c).alignment = { horizontal: 'center' };
      if (row.getCell(c).value) row.getCell(c).font = font(14, true, RED);
    }
  });
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: headers.length } };

  const gs = wb.addWorksheet('ตามกลุ่มสาระ');
  gs.columns = [
    { header: 'กลุ่มสาระ', width: 40 },
    { header: 'ครูทั้งหมด', width: 12 },
    { header: 'กรอกครบ', width: 12 },
    { header: 'ยังไม่ครบ', width: 12 },
    { header: 'ความครบถ้วน', width: 14 },
  ];
  gs.getRow(1).font = font(14, true, 'FFFFFFFF');
  gs.getRow(1).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } }; });
  for (const g of report.groups) {
    const r = gs.addRow([g.label, g.total, g.complete, g.total - g.complete, g.ratio]);
    r.font = font(14);
    r.getCell(5).numFmt = '0%';
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

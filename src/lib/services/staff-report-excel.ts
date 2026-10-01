import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { StaffReport } from '@/lib/services/staff-report';
import {
  OVERVIEW_KEY,
  SCHOOL_NAME_EN,
  SCHOOL_NAME_TH,
  STAFF_REPORT_SECTIONS,
  thaiTimestamp,
} from '@/lib/report-sections';

/**
 * รายงานบุคลากร as an .xlsx: the same sections the person ticked for the PDF.
 *
 *  - "สรุป": the school crest and name, the title and the time stamp, then each
 *    section as a small table (หมวด · จำนวน · ร้อยละ) — the PDF's page as rows.
 *  - "รายชื่อ" (when names are asked for): one row per person per section, with
 *    a filter on the header, so the office can sort and count it themselves.
 */

const PURPLE = 'FF5B2D8E';
const PALE = 'FFF1EDF7';
const MUTED = 'FF6B6478';
const FONT = 'TH Sarabun New';

export async function buildStaffReportWorkbook(
  report: StaffReport,
  keys: string[],
  withNames: boolean,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `SchoolOS — ${SCHOOL_NAME_TH}`;
  wb.created = new Date(report.asOf);
  const stamp = thaiTimestamp(report.asOf);
  const sections = STAFF_REPORT_SECTIONS.filter((s) => keys.includes(s.key));

  // -- สรุป ------------------------------------------------------------
  const ws = wb.addWorksheet('สรุป', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 4 }, { width: 46 }, { width: 12 }, { width: 12 }];
  const font = (size = 14, bold = false, color = 'FF1A1625') => ({ name: FONT, size, bold, color: { argb: color } });

  // The crest beside the heading; a missing file costs the image, not the export.
  try {
    const logo = await readFile(path.join(process.cwd(), 'public', 'icon.png'));
    const id = wb.addImage({ buffer: logo as unknown as ExcelJS.Buffer, extension: 'png' });
    ws.addImage(id, { tl: { col: 0.1, row: 0.1 }, ext: { width: 64, height: 64 } });
  } catch { /* no crest */ }

  ws.getRow(1).height = 20;
  ws.getCell('B1').value = SCHOOL_NAME_TH;
  ws.getCell('B1').font = font(20, true, PURPLE);
  ws.getCell('B2').value = SCHOOL_NAME_EN;
  ws.getCell('B2').font = font(13, false, MUTED);
  ws.getCell('B3').value = 'รายงานบุคลากร (ครูที่ปฏิบัติงานอยู่)';
  ws.getCell('B3').font = font(16, true);
  ws.getCell('B4').value = `ข้อมูล ณ วันที่ ${stamp}`;
  ws.getCell('B4').font = font(13, false, MUTED);
  for (const c of ['A5', 'B5', 'C5', 'D5']) {
    ws.getCell(c).border = { bottom: { style: 'medium', color: { argb: PURPLE } } };
  }
  ws.addRow([]);

  const total = report.total;
  const pct = (n: number) => (total ? n / total : 0);

  if (keys.includes(OVERVIEW_KEY)) {
    sectionHead(ws, 'ภาพรวม', font);
    const male = report.gender.find((g) => g.label === 'ชาย')?.people.length ?? 0;
    const female = report.gender.find((g) => g.label === 'หญิง')?.people.length ?? 0;
    for (const [label, n] of [
      ['บุคลากรทั้งหมด', total],
      ['ผู้บริหาร', report.executives],
      ['ครูผู้สอน', report.teachersOnly],
      ['ชาย', male],
      ['หญิง', female],
    ] as const) {
      dataRow(ws, label, n, pct(n), font);
    }
    ws.addRow([]);
  }

  for (const s of sections) {
    sectionHead(ws, s.title, font, s.hint);
    for (const b of report[s.field]) {
      dataRow(ws, b.label, b.people.length, pct(b.people.length), font, b.missing || s.gaps);
    }
    ws.addRow([]);
  }
  const foot = ws.addRow(['', `ออกรายงานจากระบบ SchoolOS เมื่อ ${stamp}`]);
  foot.getCell(2).font = font(11, false, MUTED);

  // -- รายชื่อ ----------------------------------------------------------
  if (withNames && sections.length) {
    const nw = wb.addWorksheet('รายชื่อ', { views: [{ state: 'frozen', ySplit: 1 }] });
    nw.columns = [
      { header: 'หัวข้อ', width: 34 },
      { header: 'หมวด', width: 34 },
      { header: 'ลำดับ', width: 8 },
      { header: 'รหัสครู', width: 12 },
      { header: 'ชื่อ-นามสกุล', width: 32 },
      { header: 'หมายเหตุ', width: 40 },
    ];
    const head = nw.getRow(1);
    head.font = font(14, true, 'FFFFFFFF');
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
    for (const s of sections) {
      for (const b of report[s.field]) {
        b.people.forEach((p, i) => {
          nw.addRow([s.title, b.label, i + 1, p.code, p.name, p.note ?? '']).font = font(14);
        });
      }
    }
    nw.autoFilter = { from: 'A1', to: 'F1' };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

type FontFn = (size?: number, bold?: boolean, color?: string) => Partial<ExcelJS.Font>;

function sectionHead(ws: ExcelJS.Worksheet, title: string, font: FontFn, hint?: string) {
  const r = ws.addRow(['', title, 'จำนวน (คน)', 'ร้อยละ']);
  r.font = font(15, true, PURPLE);
  r.getCell(3).font = font(13, true, MUTED);
  r.getCell(4).font = font(13, true, MUTED);
  r.getCell(3).alignment = { horizontal: 'right' };
  r.getCell(4).alignment = { horizontal: 'right' };
  for (let c = 1; c <= 4; c++) r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
  if (hint) ws.addRow(['', hint]).getCell(2).font = font(11, false, MUTED);
}

function dataRow(ws: ExcelJS.Worksheet, label: string, n: number, share: number, font: FontFn, warn = false) {
  const r = ws.addRow(['', label, n, share]);
  r.font = font(14);
  if (warn && n > 0) r.getCell(3).font = font(14, true, 'FFDC2626');
  r.getCell(4).numFmt = '0%';
  r.getCell(3).alignment = { horizontal: 'right' };
  r.getCell(4).alignment = { horizontal: 'right' };
  for (let c = 2; c <= 4; c++) r.getCell(c).border = { bottom: { style: 'hair', color: { argb: 'FFE2D8F1' } } };
}

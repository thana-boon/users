'use client';

import { forwardRef, useEffect, useState } from 'react';
import { withBase } from '@/lib/client';
import type { ReportBucket, StaffReport } from '@/lib/services/staff-report';
import {
  ALL_SECTION_KEYS,
  OVERVIEW_KEY,
  SCHOOL_NAME_EN,
  SCHOOL_NAME_TH,
  STAFF_REPORT_SECTIONS,
  thaiTimestamp,
} from '@/lib/report-sections';

/**
 * ส่งออกรายงาน: pick the sections, then PDF or Excel.
 *
 * PDF is the browser's own print (→ บันทึกเป็น PDF) of {@link ReportPaper}, an
 * A4 layout made for paper rather than the screen page squeezed onto one.
 * Excel is built on the server from the same section list.
 */
export interface ExportChoice {
  keys: string[];
  names: boolean;
}

const LABELS: Record<string, string> = {
  [OVERVIEW_KEY]: 'ภาพรวม (จำนวนรวม ผู้บริหาร ครู ชาย/หญิง)',
  ...Object.fromEntries(STAFF_REPORT_SECTIONS.map((s) => [s.key, s.title])),
};

export function ExportDialog({
  initial,
  onClose,
  onPdf,
}: {
  initial: ExportChoice;
  onClose: () => void;
  onPdf: (choice: ExportChoice) => void;
}) {
  const [keys, setKeys] = useState<string[]>(initial.keys);
  const [names, setNames] = useState(initial.names);
  const none = keys.length === 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (k: string) =>
    setKeys((s) => (s.includes(k) ? s.filter((x) => x !== k) : ALL_SECTION_KEYS.filter((x) => x === k || s.includes(x))));

  const excelHref = withBase(
    `/api/users/reports/staff/export?sections=${keys.join(',')}${names ? '&names=1' : ''}`,
  );

  return (
    <div className="modal-scrim no-print" role="dialog" aria-modal="true" aria-label="ส่งออกรายงาน" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="card-header row-between">
          <span>ส่งออกรายงาน</span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKeys(ALL_SECTION_KEYS)}>เลือกทั้งหมด</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKeys([])}>ล้าง</button>
          </span>
        </div>
        <div className="card-pad stack" style={{ gap: 14 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            เลือกหัวข้อที่ต้องการ — PDF จะจัดให้อยู่ในหน้าเดียวก่อน ถ้าไม่พอจึงขึ้นหน้าใหม่ · มีตราโรงเรียนและวันเวลาที่ออกรายงาน
          </p>
          <div className="exp-list">
            {ALL_SECTION_KEYS.map((k) => (
              <label key={k} className={`exp-item${keys.includes(k) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={keys.includes(k)} onChange={() => toggle(k)} />
                <span>{LABELS[k]}</span>
              </label>
            ))}
          </div>
          <label className="exp-item exp-names">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
            <span>
              แสดงรายชื่อครูในแต่ละหมวด
              <small className="muted"> (PDF จะยาวขึ้น · Excel ได้แผ่นงาน “รายชื่อ” เพิ่ม)</small>
            </span>
          </label>
          <div className="exp-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
            <a
              className={`btn btn-secondary${none ? ' is-disabled' : ''}`}
              href={none ? undefined : excelHref}
              aria-disabled={none}
              onClick={(e) => { if (none) e.preventDefault(); }}
            >
              ส่งออก Excel
            </a>
            <button type="button" className="btn btn-primary" disabled={none} onClick={() => onPdf({ keys, names })}>
              ส่งออก PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The report on A4. Sections flow in two columns and never split, so a short
 * selection lands on one page; StaffReportView shrinks it (CSS zoom) when it is
 * only a little over, and lets it run on to a second page when it is not.
 * Off-screen until printed — it is laid out all the time so it can be measured.
 */
export const ReportPaper = forwardRef<HTMLDivElement, { data: StaffReport; choice: ExportChoice; zoom: number }>(
  function ReportPaper({ data, choice, zoom }, ref) {
    const stamp = thaiTimestamp(data.asOf);
    const sections = STAFF_REPORT_SECTIONS.filter((s) => choice.keys.includes(s.key));
    const n = data.total;
    const male = data.gender.find((g) => g.label === 'ชาย')?.people.length ?? 0;
    const female = data.gender.find((g) => g.label === 'หญิง')?.people.length ?? 0;

    return (
      <div ref={ref} className="paper" style={{ zoom }} aria-hidden>
        <header className="paper-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBase('/school-seal.png')} alt="" className="paper-logo" />
          <div className="paper-school">
            <div className="paper-school-th">{SCHOOL_NAME_TH}</div>
            <div className="paper-school-en">{SCHOOL_NAME_EN}</div>
          </div>
          <div className="paper-title">
            <div className="paper-title-main">รายงานบุคลากร</div>
            <div className="paper-title-sub">ครูที่ปฏิบัติงานอยู่ · ข้อมูล ณ {stamp}</div>
          </div>
        </header>

        {choice.keys.includes(OVERVIEW_KEY) && (
          <div className="paper-kpis">
            <Kpi label="บุคลากรทั้งหมด" value={n} />
            <Kpi label="ผู้บริหาร" value={data.executives} total={n} />
            <Kpi label="ครูผู้สอน" value={data.teachersOnly} total={n} />
            <Kpi label="ชาย" value={male} total={n} />
            <Kpi label="หญิง" value={female} total={n} />
          </div>
        )}

        <div className="paper-cols">
          {sections.map((s) => (
            <section key={s.key} className="paper-sec">
              <h3>{s.title}</h3>
              {s.hint && <p className="paper-hint">{s.hint}</p>}
              <table>
                <tbody>
                  {data[s.field].map((b) => (
                    <PaperRow key={b.label} b={b} total={n} gaps={!!s.gaps} names={choice.names} />
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>

        <footer className="paper-foot">
          <span>ออกรายงานจากระบบ SchoolOS · {SCHOOL_NAME_TH}</span>
          <span>{stamp}</span>
        </footer>
      </div>
    );
  },
);

function Kpi({ label, value, total }: { label: string; value: number; total?: number }) {
  return (
    <div className="paper-kpi">
      <div className="paper-kpi-v">{value}</div>
      <div className="paper-kpi-l">
        {label}
        {total ? <span> · {Math.round((value / total) * 100)}%</span> : null}
      </div>
    </div>
  );
}

function PaperRow({ b, total, gaps, names }: { b: ReportBucket; total: number; gaps: boolean; names: boolean }) {
  const count = b.people.length;
  const share = total ? count / total : 0;
  const warn = gaps ? count > 0 : b.missing && count > 0;
  return (
    <>
      <tr className={b.missing ? 'is-missing' : undefined}>
        <td className="pl">{b.label}</td>
        <td className="pb">
          {count > 0 && <span style={{ width: `${Math.max(2, share * 100)}%` }} className={warn ? 'warn' : undefined} />}
        </td>
        <td className={`pn${warn ? ' warn' : ''}`}>{gaps && count === 0 ? 'ครบ' : count}</td>
        <td className="pp">{Math.round(share * 100)}%</td>
      </tr>
      {names && count > 0 && (
        <tr className="pnames">
          <td colSpan={4}>
            {b.people.map((p, i) => (
              <span key={p.id}>{i + 1}. {p.name}{i < count - 1 ? ' ' : ''}</span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

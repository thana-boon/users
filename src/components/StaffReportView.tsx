'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { IconChevron, IconPrinter, IconTeachers, IconShield, IconAlert } from '@/components/Icons';
import type { ReportBucket, StaffReport } from '@/lib/services/staff-report';
import { ALL_SECTION_KEYS } from '@/lib/report-sections';
import { ExportDialog, ReportPaper, type ExportChoice } from '@/components/StaffReportExport';

/** A4 printable area at 10 mm margins, in CSS px (96 dpi). */
const PAGE_W = (190 / 25.4) * 96;
const PAGE_H = (277 / 25.4) * 96;
/** Shrink to one page only while it stays readable; past this, use a second page. */
const MIN_ZOOM = 0.8;

/**
 * รายงานบุคลากร — the teachers working now, counted every way the office asks:
 * ผู้บริหาร/ครู, กลุ่มสาระ, อายุงาน, อายุ, วุฒิสูงสุด, ใบประกอบวิชาชีพ, วุฒิลูกเสือ,
 * and who has not filled what in. Every count opens to the names behind it,
 * each a link to that teacher.
 *
 * ส่งออก opens a picker (StaffReportExport): the chosen sections go to Excel
 * from the server, or to PDF through the browser's print of an A4 layout that
 * is fitted to one page when it nearly fits.
 */

type Tone = 'purple' | 'indigo' | 'blue' | 'sky' | 'teal' | 'green' | 'amber' | 'orange' | 'rose' | 'fuchsia';
const toneVar = (t: Tone) => ({ '--tone': `var(--tone-${t})` }) as CSSProperties;

const SECTIONS: { id: string; label: string }[] = [
  { id: 'overview', label: 'ภาพรวม' },
  { id: 'positions', label: 'ตำแหน่ง' },
  { id: 'subjects', label: 'กลุ่มสาระ' },
  { id: 'tenure', label: 'อายุงาน' },
  { id: 'age', label: 'อายุ' },
  { id: 'education', label: 'วุฒิการศึกษา' },
  { id: 'license', label: 'ใบประกอบวิชาชีพ' },
  { id: 'scout', label: 'วุฒิลูกเสือ' },
  { id: 'gaps', label: 'ข้อมูลที่ยังไม่กรอก' },
];

export function StaffReportView({ data }: { data: StaffReport }) {
  const [choice, setChoice] = useState<ExportChoice>({ keys: ALL_SECTION_KEYS, names: false });
  const [dialog, setDialog] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [printing, setPrinting] = useState(0);
  const paperRef = useRef<HTMLDivElement>(null);
  const asOf = useMemo(
    () => new Date(data.asOf).toLocaleDateString('th-TH', { dateStyle: 'long' }),
    [data],
  );

  // After the chosen sections have rendered into the paper: measure it at page
  // width, shrink it onto one page if it is only a little over, then print.
  useEffect(() => {
    if (!printing || !paperRef.current) return;
    const el = paperRef.current;
    el.style.zoom = '1';
    const h = el.scrollHeight;
    const fit = h > PAGE_H && h * MIN_ZOOM <= PAGE_H ? PAGE_H / h - 0.005 : 1;
    el.style.zoom = String(fit);
    setZoom(fit);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => cancelAnimationFrame(id);
  }, [printing]);

  const n = data.total;
  const male = data.gender.find((g) => g.label === 'ชาย')?.people.length ?? 0;
  const female = data.gender.find((g) => g.label === 'หญิง')?.people.length ?? 0;
  const gapCount = data.completeness.reduce((s, b) => s + (b.people.length ? 1 : 0), 0);

  return (
    <>
    <div style={{ '--paper-w': `${PAGE_W}px` } as CSSProperties}>
      <ReportPaper ref={paperRef} data={data} choice={choice} zoom={zoom} />
    </div>
    {dialog && (
      <ExportDialog
        initial={choice}
        onClose={() => setDialog(false)}
        onPdf={(c) => {
          setChoice(c);
          setDialog(false);
          setPrinting((x) => x + 1);
        }}
      />
    )}
    <div className="stack rpt rpt-screen" style={{ gap: 20 }}>
      <div className="rpt-head">
        <div>
          <h1 className="page-title">รายงานบุคลากร</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            ครูที่ปฏิบัติงานอยู่ (ไม่รวมอาจารย์พิเศษ คนงาน และผู้ที่ลาออกแล้ว) · ข้อมูล ณ วันที่ {asOf}
          </p>
        </div>
        <div className="rpt-actions no-print">
          <button type="button" className="btn btn-primary" onClick={() => setDialog(true)}>
            <IconPrinter width={18} height={18} /> ส่งออก PDF / Excel
          </button>
        </div>
      </div>

      <nav className="rpt-jump no-print" aria-label="ไปยังหัวข้อ">
        {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} className="chip">{s.label}</a>)}
      </nav>

      <section id="overview" className="grid-4 rpt-kpis">
        <Kpi tone="purple" label="บุคลากรทั้งหมด" value={n} sub="คน" Icon={IconTeachers} />
        <Kpi tone="amber" label="ผู้บริหาร" value={data.executives} sub={pct(data.executives, n)} Icon={IconShield} />
        <Kpi tone="blue" label="ครูผู้สอน" value={data.teachersOnly} sub={pct(data.teachersOnly, n)} Icon={IconTeachers} />
        <Kpi
          tone="rose"
          label="ข้อมูลที่ยังไม่ครบ"
          value={gapCount}
          sub={gapCount ? 'หัวข้อที่ยังมีคนไม่กรอก' : 'ครบทุกหัวข้อ'}
          Icon={IconAlert}
          href="#gaps"
        />
      </section>
      <p className="muted" style={{ margin: '-8px 0 0', fontSize: 13 }}>
        ชาย {male} คน · หญิง {female} คน
        {n - male - female > 0 && ` · ยังไม่ระบุเพศ ${n - male - female} คน`}
      </p>

      <ReportCard
        id="positions"
        title="ผู้บริหารและครู แยกตามตำแหน่ง"
        hint="ผู้บริหาร = ผู้รับใบอนุญาต ผู้จัดการ ผู้อำนวยการ รอง และผู้ช่วยผู้อำนวยการ · ครูที่ยังไม่ได้ระบุตำแหน่งนับเป็นครู (กำหนดตำแหน่งได้ที่หน้าข้อมูลครู)"
        buckets={data.positions}
        total={n}
        tone="amber"
      />
      <ReportCard id="subjects" title="ครูแยกตามกลุ่มสาระ" buckets={data.subjectGroups} total={n} tone="teal" />
      <ReportCard
        id="tenure"
        title="แยกตามอายุงาน"
        hint="นับจากเดือน/ปีที่เข้าทำงาน ถึงวันนี้"
        buckets={data.tenure}
        total={n}
        tone="indigo"
      />
      <ReportCard id="age" title="แยกตามอายุ" hint="นับจากวันเกิด ถึงวันนี้" buckets={data.age} total={n} tone="sky" />
      <ReportCard
        id="education"
        title="แยกตามวุฒิการศึกษาสูงสุด"
        hint="นับวุฒิที่สูงที่สุดของแต่ละคน คนละ 1 ครั้ง"
        buckets={data.education}
        total={n}
        tone="purple"
      />
      <ReportCard
        id="license"
        title="ใบประกอบวิชาชีพครู ได้มาจาก"
        buckets={data.license}
        total={n}
        tone="green"
      />

      <section id="scout" className="stack" style={{ gap: 20 }}>
        <ReportCard
          title="วุฒิลูกเสือ — วุฒิสูงสุดของแต่ละคน"
          hint="เรียง B.T.C. → A.T.C. → W.B. → A.L.T.C. → A.L.T. → L.T.C. → L.T. · คนละ 1 ครั้ง"
          buckets={data.scoutHighest}
          total={n}
          tone="orange"
        />
        <ReportCard
          title="วุฒิลูกเสือ — จำนวนผู้ที่ได้รับแต่ละวุฒิ"
          hint="คนที่มีหลายวุฒิ นับในทุกวุฒิที่ได้รับ"
          buckets={data.scoutHeld}
          total={n}
          tone="amber"
        />
      </section>

      <ReportCard
        id="gaps"
        title="ข้อมูลที่ยังไม่กรอก"
        hint="รายชื่อครูที่ยังไม่ได้กรอกแต่ละหัวข้อ — กดชื่อเพื่อไปแก้ไข หรือแจ้งให้ครูกรอกเองที่หน้า “ข้อมูลของฉัน”"
        buckets={data.completeness}
        total={n}
        tone="rose"
        gaps
      />
    </div>
    </>
  );
}

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}% ของทั้งหมด` : '—';
}

function Kpi({
  tone, label, value, sub, Icon, href,
}: {
  tone: Tone; label: string; value: number; sub: string; Icon: typeof IconTeachers; href?: string;
}) {
  const body = (
    <>
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        <span className="stat-ico"><Icon /></span>
      </div>
      <span className="stat-value">{value.toLocaleString('th-TH')}</span>
      <span className="stat-sub">{sub}</span>
    </>
  );
  return href
    ? <a href={href} className="stat" style={toneVar(tone)}>{body}</a>
    : <div className="stat" style={toneVar(tone)}>{body}</div>;
}

/**
 * One breakdown: a row per group with a bar, the count and the share, and the
 * names under it on demand. `gaps` flips the reading — the count is how many
 * have NOT filled a field in, so a full bar is bad news, drawn in the warning hue.
 */
function ReportCard({
  id, title, hint, buckets, total, tone, gaps = false,
}: {
  id?: string;
  title: string;
  hint?: string;
  buckets: ReportBucket[];
  total: number;
  tone: Tone;
  gaps?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const allOpen = buckets.every((b) => !b.people.length || open.has(b.label));
  const toggle = (label: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <section id={id} className="card rpt-card" style={toneVar(tone)}>
      <div className="rpt-card-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="section-title" style={{ marginBottom: hint ? 2 : 0 }}>{title}</h2>
          {hint && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{hint}</p>}
        </div>
        <button
          type="button"
          className="btn btn-soft btn-sm no-print"
          onClick={() => setOpen(allOpen ? new Set() : new Set(buckets.map((b) => b.label)))}
        >
          {allOpen ? 'ซ่อนรายชื่อทั้งหมด' : 'ดูรายชื่อทั้งหมด'}
        </button>
      </div>

      <div className="rpt-rows" role="list">
        {buckets.map((b) => {
          const count = b.people.length;
          const share = total ? count / total : 0;
          const isOpen = open.has(b.label);
          const warn = gaps ? count > 0 : b.missing && count > 0;
          return (
            <div key={b.label} role="listitem" className={`rpt-row${isOpen ? ' is-open' : ''}${b.missing ? ' is-missing' : ''}`}>
              <button
                type="button"
                className="rpt-row-btn"
                onClick={() => count && toggle(b.label)}
                aria-expanded={count ? isOpen : undefined}
                disabled={!count}
              >
                <span className="rpt-label">{b.label}</span>
                <span className="rpt-bar" aria-hidden>
                  <span
                    className={warn ? 'rpt-bar-fill is-warn' : 'rpt-bar-fill'}
                    style={{ width: `${Math.max(count ? 3 : 0, share * 100)}%` }}
                  />
                </span>
                <span className="rpt-count">
                  {gaps && count === 0 ? <span className="rpt-ok">ครบแล้ว</span> : <>{count} <small>คน</small></>}
                </span>
                <span className="rpt-pct">{total ? `${Math.round(share * 100)}%` : ''}</span>
                <span className="rpt-chev no-print" aria-hidden>
                  {count > 0 && <IconChevron width={16} height={16} data-open={isOpen} />}
                </span>
              </button>
              {count > 0 && (
                <ul className={`rpt-names${isOpen ? ' is-open' : ''}`} aria-label={`รายชื่อ ${b.label}`}>
                  {b.people.map((p, i) => (
                    <li key={p.id}>
                      <span className="rpt-no">{i + 1}.</span>
                      <span className="rpt-person">
                        <Link href={`/users/teachers/${p.id}`} className="rpt-name">{p.name}</Link>
                        {p.note && <span className="rpt-note">{p.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {buckets.length === 0 && <p className="muted" style={{ margin: 0 }}>ไม่มีข้อมูล</p>}
      </div>
    </section>
  );
}

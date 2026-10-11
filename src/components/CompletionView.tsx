'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { withBase } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconAlert, IconCheck, IconDownload, IconPrinter, IconTeachers } from '@/components/Icons';
import {
  COMPLETION_FIELDS,
  type CompletionKey,
  type CompletionPerson,
  type CompletionReport,
} from '@/lib/completion-fields';
import { SCHOOL_NAME_EN, SCHOOL_NAME_TH, thaiTimestamp } from '@/lib/report-sections';

/**
 * ติดตามการกรอกข้อมูล — the report turned around: per TEACHER, what is still
 * empty, so the office can chase it. Filter by กลุ่มสาระ / field, then copy a
 * ready-made reminder (grouped by กลุ่มสาระ, with the link to ข้อมูลของฉัน) into
 * LINE, export the same list to Excel, or print it.
 *
 * Fields the office fills in (ตำแหน่ง, กลุ่มสาระ) are shown apart and never put
 * in a teacher's reminder — a teacher cannot edit them.
 */

const LABEL = Object.fromEntries(COMPLETION_FIELDS.map((f) => [f.key, f.label])) as Record<CompletionKey, string>;
const NO_GROUP = 'ไม่ระบุกลุ่มสาระ';
const pct = (r: number) => `${Math.round(r * 100)}%`;
const toneVar = (t: string) => ({ '--tone': `var(--tone-${t})` }) as CSSProperties;

export function CompletionView({ data }: { data: CompletionReport }) {
  const toast = useToast();
  const [group, setGroup] = useState('');
  const [field, setField] = useState<CompletionKey | ''>('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);
  const [q, setQ] = useState('');
  const stamp = thaiTimestamp(data.asOf);

  const shown = useMemo(() => {
    const needle = q.trim();
    return data.people.filter((p) =>
      (!group || (p.subjectGroup ?? NO_GROUP) === group) &&
      (!field || p.missing.includes(field) || p.officeMissing.includes(field)) &&
      (!onlyIncomplete || p.missing.length > 0 || (field !== '' && p.officeMissing.includes(field))) &&
      (!needle || p.name.includes(needle) || p.code.includes(needle)),
    );
  }, [data.people, group, field, onlyIncomplete, q]);

  const toRemind = shown.filter((p) => p.missing.length > 0);
  const officeTodo = data.people.filter((p) => p.officeMissing.length > 0);

  const excelHref = withBase(
    `/api/users/reports/completion/export?` +
      new URLSearchParams({
        ...(group ? { group } : {}),
        ...(field ? { field } : {}),
        ...(onlyIncomplete ? { incomplete: '1' } : {}),
      }).toString(),
  );

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older iOS / insecure origins: the textarea trick still works.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(`คัดลอก${what}แล้ว — วางใน LINE หรือข้อความได้เลย`, 'success');
  }

  return (
    <div className="stack cmp" style={{ gap: 20 }}>
      {/* Paper only. */}
      <div className="cmp-print-head" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBase('/school-seal.png')} alt="" />
        <div style={{ flex: 1 }}>
          <div className="cmp-print-school">{SCHOOL_NAME_TH}</div>
          <div className="cmp-print-en">{SCHOOL_NAME_EN}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="cmp-print-title">ติดตามการกรอกข้อมูลบุคลากร</div>
          <div className="cmp-print-en">ข้อมูล ณ {stamp}</div>
        </div>
      </div>

      <div className="rpt-head">
        <div>
          <h1 className="page-title">ติดตามการกรอกข้อมูล</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            ครูแต่ละคนยังขาดอะไร · ข้อมูล ณ {stamp}
          </p>
        </div>
        <div className="rpt-actions no-print">
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
            <IconPrinter width={18} height={18} /> PDF
          </button>
          <a className="btn btn-secondary" href={excelHref}>
            <IconDownload width={18} height={18} /> Excel
          </a>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!toRemind.length}
            onClick={() => copy(reminder(toRemind, stamp), `ข้อความแจ้ง ${toRemind.length} คน`)}
          >
            คัดลอกข้อความแจ้งเตือน ({toRemind.length})
          </button>
        </div>
      </div>

      <section className="grid-4">
        <Kpi tone="purple" label="ครูทั้งหมด" value={String(data.total)} sub="คน" Icon={IconTeachers} />
        <Kpi tone="green" label="กรอกครบแล้ว" value={String(data.complete)} sub={pct(data.total ? data.complete / data.total : 0)} Icon={IconCheck} />
        <Kpi tone="rose" label="ยังไม่ครบ" value={String(data.total - data.complete)} sub="คน — ต้องติดตาม" Icon={IconAlert} />
        <Kpi tone="indigo" label="ความครบถ้วนรวม" value={pct(data.overall)} sub="ของช่องที่ครูต้องกรอก" Icon={IconCheck} />
      </section>

      <div className="grid-2 cmp-overview">
        <section className="card">
          <h2 className="section-title">ยังขาดช่องไหน กี่คน</h2>
          <p className="muted" style={{ fontSize: 12, margin: '-6px 0 10px' }}>แตะเพื่อดูเฉพาะคนที่ขาดช่องนั้น</p>
          <div className="cmp-fields">
            {data.fields.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`cmp-field${field === f.key ? ' is-on' : ''}${f.who === 'office' ? ' is-office' : ''}`}
                onClick={() => setField(field === f.key ? '' : f.key)}
                aria-pressed={field === f.key}
              >
                <span>{f.label}{f.who === 'office' && <small> (แอดมิน)</small>}</span>
                <strong className={f.missing ? 'is-bad' : 'is-ok'}>{f.missing ? `${f.missing} คน` : 'ครบ'}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">ความคืบหน้าตามกลุ่มสาระ</h2>
          <p className="muted" style={{ fontSize: 12, margin: '-6px 0 10px' }}>เรียงจากกลุ่มที่ยังขาดมากที่สุด · แตะเพื่อกรอง</p>
          <div className="cmp-groups">
            {data.groups.map((g) => (
              <button
                key={g.label}
                type="button"
                className={`cmp-group${group === g.label ? ' is-on' : ''}`}
                onClick={() => setGroup(group === g.label ? '' : g.label)}
                aria-pressed={group === g.label}
              >
                <span className="cmp-group-name">{g.label}</span>
                <span className="cmp-meter" aria-hidden><span style={{ width: pct(g.ratio) }} /></span>
                <span className="cmp-group-n">{g.complete}/{g.total} คน · {pct(g.ratio)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {officeTodo.length > 0 && (
        <div className="alert alert-info no-print" style={{ fontSize: 'var(--text-sm)' }}>
          มีครู {officeTodo.length} คนที่ <b>แอดมินยังต้องกำหนด</b> ตำแหน่งหรือกลุ่มสาระให้ (ครูแก้เองไม่ได้)
          — แตะ “ตำแหน่ง (แอดมิน)” หรือ “กลุ่มสาระ (แอดมิน)” ด้านบนเพื่อดูรายชื่อ
        </div>
      )}

      <section className="card">
        <div className="cmp-filter no-print">
          <input
            className="form-input"
            placeholder="ค้นหาชื่อหรือรหัส"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="ค้นหาชื่อหรือรหัสครู"
          />
          <select className="form-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="กลุ่มสาระ">
            <option value="">ทุกกลุ่มสาระ</option>
            {data.groups.map((g) => <option key={g.label} value={g.label}>{g.label}</option>)}
          </select>
          <select className="form-select" value={field} onChange={(e) => setField(e.target.value as CompletionKey | '')} aria-label="ช่องที่ขาด">
            <option value="">ทุกช่อง</option>
            {COMPLETION_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>ขาด{f.label}{f.who === 'office' ? ' (แอดมิน)' : ''}</option>
            ))}
          </select>
          <label className="cmp-check">
            <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
            เฉพาะคนที่ยังไม่ครบ
          </label>
        </div>

        <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
          แสดง {shown.length} คน
          {(group || field || q) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm no-print"
              style={{ marginLeft: 8, minHeight: 0, padding: '2px 10px' }}
              onClick={() => { setGroup(''); setField(''); setQ(''); }}
            >
              ล้างตัวกรอง
            </button>
          )}
        </p>

        <ol className="cmp-people">
          {shown.map((p, i) => (
            <li key={p.id} className={`cmp-person${p.missing.length ? '' : ' is-done'}`}>
              <span className="cmp-no">{i + 1}.</span>
              <div className="cmp-who">
                <Link href={`/users/teachers/${p.id}`} className="cmp-name">{p.name}</Link>
                <span className="cmp-sub">{p.code} · {p.subjectGroup ?? NO_GROUP}</span>
              </div>
              <div className="cmp-progress" aria-label={`กรอกแล้ว ${pct(p.ratio)}`}>
                <span className="cmp-meter"><span style={{ width: pct(p.ratio) }} className={p.ratio === 1 ? 'is-full' : undefined} /></span>
                <span className="cmp-pct">{pct(p.ratio)}</span>
              </div>
              <div className="cmp-tags">
                {p.missing.length === 0 && <span className="cmp-tag is-ok">กรอกครบแล้ว</span>}
                {p.missing.map((k) => <span key={k} className="cmp-tag">{LABEL[k]}</span>)}
                {p.officeMissing.map((k) => <span key={k} className="cmp-tag is-office">{LABEL[k]} (แอดมิน)</span>)}
              </div>
              {p.missing.length > 0 && (
                <button
                  type="button"
                  className="btn btn-soft btn-sm cmp-copy no-print"
                  onClick={() => copy(reminder([p], stamp), `ข้อความแจ้ง${p.name}`)}
                >
                  คัดลอก
                </button>
              )}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="muted" style={{ padding: 16 }}>
              {onlyIncomplete ? 'ไม่มีครูที่ยังกรอกไม่ครบตามตัวกรองนี้' : 'ไม่พบรายชื่อ'}
            </li>
          )}
        </ol>
      </section>
    </div>
  );
}

function Kpi({ tone, label, value, sub, Icon }: { tone: string; label: string; value: string; sub: string; Icon: typeof IconTeachers }) {
  return (
    <div className="stat" style={toneVar(tone)}>
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        <span className="stat-ico"><Icon /></span>
      </div>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

/**
 * The reminder as plain text for LINE: who, grouped by กลุ่มสาระ, with only the
 * fields the teacher can fill in, and where to do it.
 */
function reminder(people: CompletionPerson[], stamp: string): string {
  const link = `${window.location.origin}/users/me`;
  const byGroup = new Map<string, CompletionPerson[]>();
  for (const p of people) {
    const g = p.subjectGroup ?? NO_GROUP;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(p);
  }
  const lines = [
    people.length === 1
      ? `เรียน ${people[0].name}`
      : `แจ้งคุณครูที่ยังกรอกข้อมูลบุคลากรไม่ครบ (${people.length} คน)`,
    `ข้อมูล ณ ${stamp}`,
    '',
  ];
  for (const [g, ps] of byGroup) {
    if (people.length > 1) lines.push(`■ ${g} (${ps.length} คน)`);
    ps.forEach((p, i) => {
      const what = p.missing.map((k) => LABEL[k]).join(', ');
      lines.push(people.length > 1 ? `${i + 1}. ${p.name} — ยังขาด: ${what}` : `ยังขาดข้อมูล: ${what}`);
    });
    lines.push('');
  }
  lines.push(`กรอกได้ที่ SchoolOS > ข้อมูลของฉัน`, link, 'ขอบคุณค่ะ/ครับ');
  return lines.join('\n');
}

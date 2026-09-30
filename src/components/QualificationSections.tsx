'use client';

import { useEffect, useId, useState } from 'react';
import { Combo } from './Combo';
import { ChoiceChips } from './ChoiceChips';
import { DateField } from './DateField';
import { RepeatList } from './RepeatList';
import {
  DEGREE_LEVEL_OPTIONS,
  DEGREE_LEVELS_WITH_NAME,
  DEGREE_NAME_OPTIONS,
  DEGREE_NAMES_BY_LEVEL,
  FACULTY_OPTIONS,
  facultyForDegree,
  MAJOR_OPTIONS,
  SCOUT_QUALIFICATION_OPTIONS,
  SCOUT_TYPE_OPTIONS,
  TEACHING_LICENSE_OPTIONS,
  scoutRank,
  UNIVERSITY_OPTIONS,
} from '@/lib/options';

/**
 * วุฒิการศึกษา / วุฒิทางลูกเสือ / การผ่านอบรม — the three repeatable lists on a
 * teacher, written once and rendered by both the admin detail page and the
 * teacher's own page (/users/me).
 *
 * Shared deliberately: these fields are self-service (the office never had the
 * certificates), so the admin view exists to correct what the teacher entered.
 * Two copies of the form would drift, and the first time they did, an admin
 * would be looking at a field the teacher cannot see.
 */

// The row shapes are exactly the JSON the API takes — see lib/services/teachers.
export interface EducationRow {
  degreeLevel?: string | null;
  degreeName?: string | null;
  major?: string | null;
  faculty?: string | null;
  institution?: string | null;
  graduationYear?: string | null;
}

export interface ScoutRow {
  qualification?: string | null;
  scoutType?: string | null;
  trainedAt?: string | null;
  certificateNo?: string | null;
  issuedDate?: string | null;
}

export interface TrainingRow {
  title?: string | null;
  organizer?: string | null;
  venue?: string | null;
  hours?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  certificateNo?: string | null;
}

/** All three lists as one object — what a form holds and a PATCH sends. */
export interface QualificationLists {
  educations: EducationRow[];
  scoutQualifications: ScoutRow[];
  trainings: TrainingRow[];
}

export const EMPTY_LISTS: QualificationLists = {
  educations: [],
  scoutQualifications: [],
  trainings: [],
};

/** A plain text field inside a repeat row. */
function Field({
  label,
  value,
  onChange,
  placeholder,
  wide = false,
  inputMode,
  required = false,
  error,
  note,
  maxLength,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  required?: boolean;
  /** Blocks nothing by itself — RepeatList decides; this only draws it. */
  error?: string;
  /** A warning under the box (not an error): e.g. a year that looks like ค.ศ. */
  note?: React.ReactNode;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className={`form-label${required ? ' required' : ''}`} htmlFor={id}>{label}</label>
      <input
        id={id}
        autoComplete="off"
        inputMode={inputMode}
        maxLength={maxLength}
        className={`form-input${error ? ' error' : ''}`}
        aria-invalid={error ? true : undefined}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {error && <p className="form-error">{error}</p>}
      {note}
    </div>
  );
}

/**
 * ปีที่จบ is พ.ศ.; a Gregorian year is the usual slip. Say so, and offer the
 * converted year as one tap — but never block the save on it.
 */
function GraduationYearNote({ value, onFix }: { value: string | null | undefined; onFix: (v: string) => void }) {
  const v = (value ?? '').trim();
  if (!v) return null;
  const warn = (children: React.ReactNode) => (
    <p className="form-hint" style={{ color: 'var(--color-warning)' }}>{children}</p>
  );
  if (!/^\d{4}$/.test(v)) return warn('ใส่เป็นปี พ.ศ. 4 หลัก เช่น 2560');
  const n = Number(v);
  const thisYearBE = new Date().getFullYear() + 543;
  if (n < 2400) {
    return warn(
      <>
        ดูเหมือนเป็นปี ค.ศ. —{' '}
        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', minHeight: 0 }} onClick={() => onFix(String(n + 543))}>
          ใช้ พ.ศ. {n + 543}
        </button>
      </>,
    );
  }
  if (n > thisYearBE + 1) return warn(`ปี ${n} ยังมาไม่ถึง — ตรวจตัวเลขอีกครั้ง`);
  return null;
}

/** "ค.บ. (ภาษาไทย) — มหาวิทยาลัยราชภัฏ…" and friends, for the read-only view. */
function joinParts(parts: Array<string | null | undefined>, sep = ' · '): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(sep);
}

export function EducationList({
  rows,
  onChange,
  readOnly = false,
}: {
  rows: EducationRow[];
  onChange: (rows: EducationRow[]) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
  return (
    <RepeatList<EducationRow>
      title="วุฒิการศึกษา"
      hint="จบหลายใบก็กด “เพิ่มวุฒิ” ได้เรื่อย ๆ — เรียงจากวุฒิสูงสุดลงมาตามที่ต้องการ"
      rows={rows}
      onChange={onChange}
      blank={() => ({})}
      addLabel="เพิ่มวุฒิ"
      emptyLabel="ยังไม่ได้บันทึกวุฒิการศึกษา"
      readOnly={readOnly}
      // A degree names its ปริญญา and วิชาเอก; a ปวช. or ม.ปลาย row may not
      // have either, so only the level and the institution are asked of it.
      required={(r) => (isDegree(r.degreeLevel)
        ? {
            degreeLevel: 'ระดับการศึกษา',
            degreeName: 'ชื่อปริญญา / วุฒิ',
            major: 'วิชาเอก / สาขาวิชา',
            institution: 'มหาวิทยาลัย / สถาบัน',
          }
        : { degreeLevel: 'ระดับการศึกษา', institution: 'สถาบัน' })}
      renderSummary={(r) => (
        <>
          <div style={{ fontWeight: 600 }}>
            {joinParts([r.degreeLevel, r.degreeName], ' ') || '—'}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {joinParts([r.major && `วิชาเอก ${r.major}`, r.faculty, r.institution,
              r.graduationYear && `ปีที่จบ ${r.graduationYear}`])}
          </div>
        </>
      )}
      renderRow={(r, set, err) => {
        const degree = isDegree(r.degreeLevel);
        const names = r.degreeLevel
          ? (DEGREE_NAMES_BY_LEVEL[r.degreeLevel as keyof typeof DEGREE_NAMES_BY_LEVEL] ?? [])
          : DEGREE_NAME_OPTIONS;
        return (
          <>
            {/* Eight levels: tap one, no list to open. */}
            <ChoiceChips
              label="ระดับการศึกษา"
              required
              value={r.degreeLevel}
              onChange={set('degreeLevel')}
              options={DEGREE_LEVEL_OPTIONS}
              otherPlaceholder="เช่น ป.กศ.สูง"
              error={err('degreeLevel')}
            />
            {/* Suggestions narrowed to the level just picked, not a closed list —
                see DEGREE_NAME_OPTIONS. Raw text is kept (normalize off): the
                certificate's own spelling wins. */}
            <Combo
              label={degree ? 'ชื่อปริญญา / วุฒิ' : 'ชื่อวุฒิ'}
              required={degree}
              value={r.degreeName}
              onChange={(v) => {
                set('degreeName')(v);
                // ค.บ. is awarded by ครุศาสตร์, and so on — fill คณะ while it is
                // still blank, never over what someone typed.
                const f = facultyForDegree(v);
                if (f && !(r.faculty ?? '').trim()) set('faculty')(f);
              }}
              options={names}
              normalize={false}
              placeholder={names.length ? 'เลือกหรือพิมพ์ เช่น ค.บ.' : 'พิมพ์ชื่อวุฒิ เช่น ปวส. ช่างไฟฟ้า'}
              error={err('degreeName')}
            />
            <Combo
              label={degree ? 'วิชาเอก / สาขาวิชา' : 'สาขา / แผนการเรียน'}
              required={degree}
              value={r.major}
              onChange={set('major')}
              options={MAJOR_OPTIONS}
              normalize={false}
              placeholder="เลือกหรือพิมพ์ เช่น ภาษาไทย"
              error={err('major')}
            />
            {/* Kept on screen while it holds something, so nothing saved is hidden. */}
            {(degree || (r.faculty ?? '').trim() !== '') && (
              <Combo
                label="คณะ"
                value={r.faculty}
                onChange={set('faculty')}
                options={FACULTY_OPTIONS}
                normalize={false}
                placeholder="เลือกหรือพิมพ์ เช่น ครุศาสตร์"
              />
            )}
            <Combo
              label={degree ? 'มหาวิทยาลัย / สถาบัน' : 'สถาบัน'}
              required
              value={r.institution}
              onChange={set('institution')}
              options={UNIVERSITY_OPTIONS}
              normalize={false}
              placeholder="พิมพ์ชื่อมหาวิทยาลัยหรือสถาบันเพื่อค้นหา"
              error={err('institution')}
            />
            <Field
              label="ปีที่สำเร็จการศึกษา (พ.ศ.)"
              value={r.graduationYear}
              onChange={set('graduationYear')}
              placeholder="เว้นว่างได้ เช่น 2560"
              inputMode="numeric"
              maxLength={4}
              note={<GraduationYearNote value={r.graduationYear} onFix={set('graduationYear')} />}
            />
          </>
        );
      }}
    />
  );
}

/** Blank counts as a degree: the stricter set of fields until a level says otherwise. */
function isDegree(level: string | null | undefined): boolean {
  const l = (level ?? '').trim();
  return !l || DEGREE_LEVELS_WITH_NAME.includes(l);
}

export function ScoutList({
  rows: unsorted,
  onChange: persist,
  readOnly = false,
}: {
  rows: ScoutRow[];
  onChange: (rows: ScoutRow[]) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
  // Always B.T.C. → A.T.C. → W.B. → A.L.T.C. → A.L.T. → L.T.C. → L.T., top to
  // bottom — shown that way, and saved that way on the next บันทึก. The editor
  // indexes into this sorted list, and every save sorts again, so an index
  // never points at the wrong row.
  const rows = sortScout(unsorted);
  const onChange = (next: ScoutRow[]) => persist(sortScout(next));
  return (
    <RepeatList<ScoutRow>
      title="วุฒิทางลูกเสือ"
      hint="ผ่านมาหลายขั้นก็ติ๊กได้หลายวุฒิพร้อมกัน แต่ละวุฒิจะเป็นหนึ่งรายการ แล้วกรอกเลขที่/วันที่ของแต่ละใบ"
      rows={rows}
      onChange={onChange}
      blank={() => ({})}
      addLabel="เพิ่มวุฒิลูกเสือ"
      toolbar={<ScoutQuickPick rows={rows} onChange={onChange} />}
      emptyLabel="ยังไม่ได้บันทึกวุฒิทางลูกเสือ"
      readOnly={readOnly}
      required={{ qualification: 'วุฒิ / ขั้นการฝึกอบรม' }}
      renderSummary={(r) => (
        <>
          <div style={{ fontWeight: 600 }}>{r.qualification?.trim() || '—'}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {joinParts([r.scoutType, r.trainedAt,
              r.certificateNo && `เลขที่ ${r.certificateNo}`, r.issuedDate])}
          </div>
        </>
      )}
      renderRow={(r, set, err) => (
        <>
          <Combo
            label="วุฒิ / ขั้นการฝึกอบรม"
            required
            error={err('qualification')}
            value={r.qualification}
            onChange={set('qualification')}
            options={SCOUT_QUALIFICATION_OPTIONS}
            // Free text, unnormalised: the warrants themselves are spelled a
            // dozen ways and snapping them would rewrite what the paper says.
            normalize={false}
            style={{ gridColumn: '1 / -1' }}
          />
          <ChoiceChips
            label="ประเภทลูกเสือ"
            value={r.scoutType}
            onChange={set('scoutType')}
            options={SCOUT_TYPE_OPTIONS}
          />
          <Field
            label="หน่วย / ค่ายที่จัดอบรม"
            value={r.trainedAt}
            onChange={set('trainedAt')}
            placeholder="เช่น ค่ายลูกเสือจังหวัด…"
          />
          <Field
            label="เลขที่วุฒิบัตร"
            value={r.certificateNo}
            onChange={set('certificateNo')}
          />
          <DateField label="วันที่ได้รับวุฒิ" value={r.issuedDate} onChange={set('issuedDate')} />
        </>
      )}
    />
  );
}

/**
 * The warrants as tick boxes: a teacher who holds B.T.C., A.T.C. and W.B. ticks
 * three and gets three rows, instead of pressing "เพิ่ม" and picking from the
 * combo three times. Each warrant stays its own row because each is its own
 * certificate, with its own number and date.
 *
 * Ticking only ADDS, and saves at once like any other row — the new card then
 * has its own แก้ไข for the number and date. An already-listed warrant shows
 * ticked and greyed; taking it off is the row's own ลบ, so a tick box can never
 * throw away a certificate number someone typed.
 */
function ScoutQuickPick({
  rows,
  onChange,
}: {
  rows: ScoutRow[];
  onChange: (rows: ScoutRow[]) => void | Promise<unknown>;
}) {
  const have = new Set(rows.map((r) => r.qualification?.trim()).filter(Boolean));
  return (
    <div style={{ marginTop: 10 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>เลือกวุฒิที่ได้รับ (เลือกได้หลายวุฒิ)</div>
      <div className="scout-pick">
        {SCOUT_QUALIFICATION_OPTIONS.map((q) => {
          const on = have.has(q);
          const [name, code] = splitScout(q);
          return (
            <label key={q} className={`scout-pick-row${on ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={on}
                onChange={() => {
                  // A failed save has already been reported by the parent.
                  Promise.resolve(onChange([...rows, { qualification: q }])).catch(() => {});
                }}
              />
              <span className="scout-pick-name">{name}</span>
              {code && <span className="scout-pick-code">{code}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** "วูดแบดจ์ 2 ท่อน (W.B.)" → ["วูดแบดจ์ 2 ท่อน", "W.B."]. */
function splitScout(q: string): [string, string] {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(q);
  return m ? [m[1], m[2]] : [q, ''];
}

/** Stable sort by scoutRank: equal ranks (two hand-typed rows) keep their order. */
function sortScout(rows: ScoutRow[]): ScoutRow[] {
  return rows
    .map((r, i) => ({ r, i, k: scoutRank(r.qualification) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.r);
}

export function TrainingList({
  rows,
  onChange,
  readOnly = false,
}: {
  rows: TrainingRow[];
  onChange: (rows: TrainingRow[]) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
  return (
    <RepeatList<TrainingRow>
      title="การผ่านการอบรม"
      hint="ชื่อการอบรม · หน่วยงานที่จัด · จำนวนชั่วโมง — เพิ่มได้ทุกครั้งที่ไปอบรม"
      rows={rows}
      onChange={onChange}
      blank={() => ({})}
      addLabel="เพิ่มการอบรม"
      emptyLabel="ยังไม่ได้บันทึกประวัติการอบรม"
      readOnly={readOnly}
      required={{ title: 'ชื่อการอบรม', organizer: 'หน่วยงานที่จัดอบรม' }}
      renderSummary={(r) => (
        <>
          <div style={{ fontWeight: 600 }}>{r.title?.trim() || '—'}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {joinParts([r.organizer, r.venue, r.hours && `${r.hours} ชั่วโมง`,
              joinParts([r.startDate, r.endDate], ' - '),
              r.certificateNo && `เลขที่ ${r.certificateNo}`])}
          </div>
        </>
      )}
      renderRow={(r, set, err) => (
        <>
          <Field
            label="ชื่อการอบรม"
            required
            error={err('title')}
            value={r.title}
            onChange={set('title')}
            placeholder="เช่น การจัดการเรียนรู้เชิงรุก (Active Learning)"
            wide
          />
          <Field
            label="หน่วยงานที่จัดอบรม"
            required
            error={err('organizer')}
            value={r.organizer}
            onChange={set('organizer')}
            placeholder="เช่น สพฐ., สพป.เชียงใหม่ เขต 1"
          />
          <Field
            label="สถานที่อบรม"
            value={r.venue}
            onChange={set('venue')}
            placeholder="เช่น โรงแรม…, ออนไลน์"
          />
          <Field
            label="จำนวนชั่วโมง"
            value={r.hours}
            onChange={set('hours')}
            placeholder="เช่น 12"
            inputMode="decimal"
          />
          <Field
            label="เลขที่เกียรติบัตร"
            value={r.certificateNo}
            onChange={set('certificateNo')}
          />
          <DateField label="วันที่เริ่มอบรม" value={r.startDate} onChange={set('startDate')} />
          <DateField label="วันที่สิ้นสุด" value={r.endDate} onChange={set('endDate')} />
        </>
      )}
    />
  );
}

/**
 * ใบประกอบวิชาชีพครู ได้มาจาก — one answer, saved the moment it is tapped (like
 * a วุฒิ row, it does not wait for the page's save bar). Beside the degrees
 * because that is where the question comes from: a teacher without ค.บ./ศษ.บ.
 * still holds a licence, through ป.บัณฑิต or the คุรุสภา test.
 */
function TeachingLicenseCard({
  value,
  onSave,
  readOnly,
}: {
  value: string | null | undefined;
  onSave: (v: string) => Promise<unknown>;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value ?? ''), [value]);
  const saved = (value ?? '').trim();
  const pending = draft.trim() !== saved;

  async function save(v: string) {
    setBusy(true);
    try { await onSave(v.trim()); } catch { setDraft(value ?? ''); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: 2 }}>ใบประกอบวิชาชีพครู</h2>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>ได้ใบประกอบวิชาชีพครูมาจากทางใด — แตะเลือกแล้วบันทึกทันที</p>
        </div>
        {saved && !pending && <span className="badge badge-success">บันทึกแล้ว</span>}
      </div>
      {readOnly ? (
        <p style={{ margin: 0 }}>{saved || <span className="muted">ยังไม่ได้ระบุ</span>}</p>
      ) : (
        <div className={saved && !pending ? 'rl-saved' : undefined} style={saved && !pending ? undefined : { padding: 0 }}>
          <ChoiceChips
            label="ได้มาจาก"
            value={draft}
            onChange={(v) => {
              setDraft(v);
              // A chip is the whole answer: save it now. Free text ("อื่น ๆ")
              // waits for its own บันทึก so every keystroke is not a request.
              if ((TEACHING_LICENSE_OPTIONS as readonly string[]).includes(v)) void save(v);
            }}
            options={TEACHING_LICENSE_OPTIONS}
            otherPlaceholder="เช่น หนังสืออนุญาตให้ประกอบวิชาชีพชั่วคราว"
          />
          {/* Free text, or a chip tapped off: nothing is saved until this is pressed. */}
          {pending && !(TEACHING_LICENSE_OPTIONS as readonly string[]).includes(draft) && (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(draft)}>
                {busy ? 'กำลังบันทึก…' : draft.trim() ? 'บันทึก' : 'บันทึก (ไม่ระบุ)'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDraft(value ?? '')}>
                ยกเลิก
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * All three, in the order they appear on both pages.
 *
 * Each row saves on its own บันทึก (see RepeatList), so `onChange` gets just
 * the one list that changed and is expected to persist it — a list-only PATCH,
 * which both the self and the admin endpoints accept. Reject to keep the row's
 * editor open.
 */
export function QualificationSections({
  lists,
  onChange,
  readOnly = false,
  license,
}: {
  lists: QualificationLists;
  onChange: (patch: Partial<QualificationLists>) => void | Promise<unknown>;
  readOnly?: boolean;
  /** ใบประกอบวิชาชีพครู — shown under วุฒิการศึกษา when given; saves on tap. */
  license?: { value: string | null | undefined; onSave: (v: string) => Promise<unknown> };
}) {
  return (
    <>
      <EducationList
        rows={lists.educations}
        onChange={(educations) => onChange({ educations })}
        readOnly={readOnly}
      />
      {license && <TeachingLicenseCard {...license} readOnly={readOnly} />}
      <ScoutList
        rows={lists.scoutQualifications}
        onChange={(scoutQualifications) => onChange({ scoutQualifications })}
        readOnly={readOnly}
      />
      <TrainingList
        rows={lists.trainings}
        onChange={(trainings) => onChange({ trainings })}
        readOnly={readOnly}
      />
    </>
  );
}

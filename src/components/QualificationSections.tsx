'use client';

import { useId } from 'react';
import { Combo } from './Combo';
import { DateField } from './DateField';
import { RepeatList } from './RepeatList';
import {
  DEGREE_LEVEL_OPTIONS,
  DEGREE_NAME_OPTIONS,
  FACULTY_OPTIONS,
  MAJOR_OPTIONS,
  SCOUT_QUALIFICATION_OPTIONS,
  SCOUT_TYPE_OPTIONS,
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
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  const id = useId();
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        autoComplete="off"
        inputMode={inputMode}
        className="form-input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
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
      renderRow={(r, set) => (
        <>
          <Combo
            label="ระดับการศึกษา"
            value={r.degreeLevel}
            onChange={set('degreeLevel')}
            options={DEGREE_LEVEL_OPTIONS}
          />
          {/* Suggestions, not a closed list — see DEGREE_NAME_OPTIONS. Raw text
              is kept (normalize off): the certificate's own spelling wins. */}
          <Combo
            label="ชื่อปริญญา / วุฒิ"
            value={r.degreeName}
            onChange={set('degreeName')}
            options={DEGREE_NAME_OPTIONS}
            normalize={false}
            placeholder="เลือกหรือพิมพ์ เช่น ค.บ."
          />
          <Combo
            label="วิชาเอก / สาขาวิชา"
            value={r.major}
            onChange={set('major')}
            options={MAJOR_OPTIONS}
            normalize={false}
            placeholder="เลือกหรือพิมพ์ เช่น ภาษาไทย"
          />
          <Combo
            label="คณะ"
            value={r.faculty}
            onChange={set('faculty')}
            options={FACULTY_OPTIONS}
            normalize={false}
            placeholder="เลือกหรือพิมพ์ เช่น ครุศาสตร์"
          />
          <Combo
            label="มหาวิทยาลัย / สถาบัน"
            value={r.institution}
            onChange={set('institution')}
            options={UNIVERSITY_OPTIONS}
            normalize={false}
            placeholder="พิมพ์ชื่อมหาวิทยาลัยหรือสถาบันเพื่อค้นหา"
          />
          <Field
            label="ปีที่สำเร็จการศึกษา (พ.ศ.) — ไม่บังคับ"
            value={r.graduationYear}
            onChange={set('graduationYear')}
            placeholder="เว้นว่างได้ เช่น 2560"
            inputMode="numeric"
          />
        </>
      )}
    />
  );
}

export function ScoutList({
  rows,
  onChange,
  readOnly = false,
}: {
  rows: ScoutRow[];
  onChange: (rows: ScoutRow[]) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
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
      renderSummary={(r) => (
        <>
          <div style={{ fontWeight: 600 }}>{r.qualification?.trim() || '—'}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {joinParts([r.scoutType, r.trainedAt,
              r.certificateNo && `เลขที่ ${r.certificateNo}`, r.issuedDate])}
          </div>
        </>
      )}
      renderRow={(r, set) => (
        <>
          <Combo
            label="วุฒิ / ขั้นการฝึกอบรม"
            value={r.qualification}
            onChange={set('qualification')}
            options={SCOUT_QUALIFICATION_OPTIONS}
            // Free text, unnormalised: the warrants themselves are spelled a
            // dozen ways and snapping them would rewrite what the paper says.
            normalize={false}
            style={{ gridColumn: '1 / -1' }}
          />
          <Combo
            label="ประเภทลูกเสือ"
            value={r.scoutType}
            onChange={set('scoutType')}
            options={SCOUT_TYPE_OPTIONS}
            normalize={false}
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
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {SCOUT_QUALIFICATION_OPTIONS.map((q) => {
          const on = have.has(q);
          return (
            <label
              key={q}
              className="chip"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                cursor: on ? 'default' : 'pointer', opacity: on ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={on}
                onChange={() => {
                  // A failed save has already been reported by the parent.
                  Promise.resolve(onChange([...rows, { qualification: q }])).catch(() => {});
                }}
              />
              {q}
            </label>
          );
        })}
      </div>
    </div>
  );
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
      renderRow={(r, set) => (
        <>
          <Field
            label="ชื่อการอบรม"
            value={r.title}
            onChange={set('title')}
            placeholder="เช่น การจัดการเรียนรู้เชิงรุก (Active Learning)"
            wide
          />
          <Field
            label="หน่วยงานที่จัดอบรม"
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
}: {
  lists: QualificationLists;
  onChange: (patch: Partial<QualificationLists>) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
  return (
    <>
      <EducationList
        rows={lists.educations}
        onChange={(educations) => onChange({ educations })}
        readOnly={readOnly}
      />
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

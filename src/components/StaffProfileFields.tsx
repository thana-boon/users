'use client';

import { useEffect, useId, useState } from 'react';
import { Combo } from './Combo';
import { PhoneInput } from './PhoneInput';
import { EMERGENCY_RELATIONSHIP_OPTIONS, PROVINCE_OPTIONS } from '@/lib/options';
import { TH_MONTHS_FULL } from '@/lib/thai';

/**
 * The teacher fields added in 2026-09 — ผู้ติดต่อฉุกเฉิน, ที่อยู่ตามทะเบียนบ้าน,
 * เดือน/ปีที่เข้าทำงาน — written once and rendered by both the admin teacher
 * page and the teacher's own page, for the same reason QualificationSections
 * is shared: two copies of a form drift.
 */

/** Mirrors HOUSEHOLD_ADDRESS_KEYS in lib/services/teachers.ts (server-only file). */
export interface HouseholdAddressForm {
  houseNo?: string | null;
  moo?: string | null;
  soi?: string | null;
  road?: string | null;
  subDistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  houseRegCode?: string | null;
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  inputMode,
  maxLength,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        maxLength={maxLength}
        autoComplete="off"
        className="form-input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
      />
    </div>
  );
}

/** ที่อยู่ตามทะเบียนบ้าน — the same field set a student address has. */
export function HouseholdAddressFields({
  value,
  onChange,
  disabled = false,
}: {
  value: HouseholdAddressForm;
  onChange: (v: HouseholdAddressForm) => void;
  disabled?: boolean;
}) {
  const set = (k: keyof HouseholdAddressForm) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <>
      <Text label="บ้านเลขที่" value={value.houseNo} onChange={set('houseNo')} disabled={disabled} />
      <Text label="หมู่ที่" value={value.moo} onChange={set('moo')} disabled={disabled} />
      <Text label="ซอย" value={value.soi} onChange={set('soi')} disabled={disabled} />
      <Text label="ถนน" value={value.road} onChange={set('road')} disabled={disabled} />
      <Text label="ตำบล / แขวง" value={value.subDistrict} onChange={set('subDistrict')} disabled={disabled} />
      <Text label="อำเภอ / เขต" value={value.district} onChange={set('district')} disabled={disabled} />
      {disabled ? (
        <Text label="จังหวัด" value={value.province} onChange={set('province')} disabled />
      ) : (
        <Combo label="จังหวัด" value={value.province} onChange={set('province')} options={PROVINCE_OPTIONS} />
      )}
      <Text
        label="รหัสไปรษณีย์"
        value={value.postalCode}
        onChange={set('postalCode')}
        inputMode="numeric"
        maxLength={5}
        disabled={disabled}
      />
      <Text
        label="รหัสประจำบ้าน (ถ้ามี)"
        value={value.houseRegCode}
        onChange={set('houseRegCode')}
        placeholder="11 หลัก ตามหน้าทะเบียนบ้าน"
        inputMode="numeric"
        disabled={disabled}
      />
    </>
  );
}

/** ผู้ติดต่อฉุกเฉิน — ชื่อ, เบอร์, ความเกี่ยวข้อง. */
export function EmergencyContactFields({
  name,
  phone,
  relationship,
  onChange,
  disabled = false,
}: {
  name: string | null | undefined;
  phone: string | null | undefined;
  relationship: string | null | undefined;
  onChange: (k: 'emergencyContactName' | 'emergencyPhone' | 'emergencyRelationship', v: string) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Text
        label="ชื่อผู้ติดต่อฉุกเฉิน"
        value={name}
        onChange={(v) => onChange('emergencyContactName', v)}
        placeholder="ชื่อ-นามสกุล"
        disabled={disabled}
      />
      <PhoneInput
        label="เบอร์ติดต่อฉุกเฉิน"
        value={phone}
        onChange={(v) => onChange('emergencyPhone', v)}
        disabled={disabled}
      />
      {disabled ? (
        <Text label="ความเกี่ยวข้อง" value={relationship} onChange={() => {}} disabled />
      ) : (
        <Combo
          label="ความเกี่ยวข้อง"
          value={relationship}
          onChange={(v) => onChange('emergencyRelationship', v)}
          options={EMERGENCY_RELATIONSHIP_OPTIONS}
          normalize={false}
          placeholder="เลือกหรือพิมพ์ เช่น มารดา"
        />
      )}
    </>
  );
}

/**
 * เดือน/ปีที่เข้าทำงาน — a month picker plus a พ.ศ. year box, stored as
 * "mm/BBBB". Emits '' when both halves are empty. A half-filled value is emitted
 * as-is so the server's message ("ต้องเป็น ดด/ปปปป") says what is missing,
 * rather than the half the person did fill in vanishing on save.
 */
export function MonthYearField({
  label,
  value,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const parse = (v: string | null | undefined) => {
    // Either half may be missing while it is being filled in ("05/", "/2560").
    const m = /^(\d{0,2})\/(\d{0,4})$/.exec(v?.trim() ?? '');
    return { month: m ? String(Number(m[1]) || '') : '', year: m ? m[2] : '' };
  };
  const [parts, setParts] = useState(() => parse(value));
  const id = useId();
  // Follow a value that changes from outside (a reload after save).
  useEffect(() => setParts(parse(value)), [value]);

  function emit(next: { month: string; year: string }) {
    setParts(next);
    if (!next.month && !next.year) return onChange('');
    onChange(`${next.month ? next.month.padStart(2, '0') : ''}/${next.year}`);
  }

  return (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <div className="row" style={{ gap: 8 }}>
        <select
          id={id}
          className="form-select"
          value={parts.month}
          onChange={(e) => emit({ ...parts, month: e.target.value })}
          disabled={disabled}
          aria-label="เดือน"
          style={{ flex: 1, minWidth: 0 }}
        >
          <option value="">— เดือน —</option>
          {TH_MONTHS_FULL.map((name, i) => (
            <option key={name} value={String(i + 1)}>{name}</option>
          ))}
        </select>
        <input
          className="form-input"
          value={parts.year}
          onChange={(e) => emit({ ...parts, year: e.target.value.replace(/\D/g, '').slice(0, 4) })}
          placeholder="ปี พ.ศ."
          inputMode="numeric"
          disabled={disabled}
          aria-label="ปี พ.ศ."
          style={{ width: 104, flex: 'none' }}
        />
      </div>
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Combo } from './Combo';
import { PROVINCE_OPTIONS } from '@/lib/options';
import {
  byPostalCode,
  loadAddressData,
  sameArea,
  searchSubDistrict,
  type AddressArea,
} from '@/lib/thai-address';

/**
 * รหัสไปรษณีย์ → ตำบล/แขวง → อำเภอ/เขต → จังหวัด, as grid children for any
 * address form (teacher ทะเบียนบ้าน, a student's addresses).
 *
 * The postal code comes FIRST: five digits bring up the ตำบล that use it, and
 * one tap fills ตำบล, อำเภอ and จังหวัด together. Someone who does not know the
 * code types the ตำบล name instead and gets the same list, code included.
 * Every field stays an ordinary editable box — the lists only suggest, so an
 * address the data does not know is typed exactly as before, and a saved
 * address is shown as saved (the lists open only once someone types).
 */

type Value = {
  subDistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
};

export function AddressAreaFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Value;
  /** Called with only the keys that changed — one key when typing, four on a pick. */
  onChange: (patch: Partial<AddressArea>) => void;
  disabled?: boolean;
}) {
  const [data, setData] = useState<AddressArea[] | null>(null);
  // The lists open only after a person types into that box, never for a value
  // that was already saved — opening the form must not look like it wants changes.
  const [zipTyped, setZipTyped] = useState(false);
  const [nameTyped, setNameTyped] = useState(false);
  const zipId = useId();
  const subId = useId();
  const disId = useId();

  useEffect(() => {
    if (disabled) return;
    let live = true;
    loadAddressData().then((d) => { if (live) setData(d); }).catch(() => { /* suggestions only */ });
    return () => { live = false; };
  }, [disabled]);

  const zip = (value.postalCode ?? '').trim();
  const zipHits = useMemo(() => (data ? byPostalCode(data, zip) : []), [data, zip]);
  const nameHits = useMemo(
    () => (data && nameTyped ? searchSubDistrict(data, value.subDistrict ?? '') : []),
    [data, nameTyped, value.subDistrict],
  );

  const showZip = zipTyped && zipHits.length > 0 && !zipHits.some((r) => sameArea(value, r));
  const showName = !showZip && nameTyped && nameHits.length > 0 && !nameHits.some((r) => sameArea(value, r));
  const zipUnknown = zipTyped && data !== null && /^\d{5}$/.test(zip) && zipHits.length === 0;

  const bangkok = (value.province ?? '').includes('กรุงเทพ');
  const hasArea = [value.postalCode, value.subDistrict, value.district, value.province].some((x) => (x ?? '').trim());

  function pick(r: AddressArea) {
    onChange({ ...r });
    setZipTyped(false);
    setNameTyped(false);
  }

  return (
    <>
      <div style={{ gridColumn: '1 / -1' }}>
        <div className="row-between" style={{ alignItems: 'baseline', gap: 8 }}>
          <label className="form-label" htmlFor={zipId}>รหัสไปรษณีย์</label>
          {!disabled && hasArea && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ minHeight: 0, padding: '2px 8px' }}
              onClick={() => {
                onChange({ postalCode: '', subDistrict: '', district: '', province: '' });
                setZipTyped(false);
                setNameTyped(false);
              }}
            >
              ล้างที่อยู่
            </button>
          )}
        </div>
        <input
          id={zipId}
          className="form-input"
          style={{ maxWidth: 220 }}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          placeholder="5 หลัก เช่น 50200"
          value={value.postalCode ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 5);
            setZipTyped(true);
            const hits = data && v.length === 5 ? byPostalCode(data, v) : [];
            if (!hits.length) { onChange({ postalCode: v }); return; }
            // Fill straight away whatever the code settles: จังหวัด, อำเภอ when
            // every ตำบล under it shares one, and ตำบล when there is only one.
            // A ตำบล already typed that fits the code is kept.
            const one = <K extends keyof AddressArea>(k: K) =>
              new Set(hits.map((h) => h[k])).size === 1 ? hits[0][k] : '';
            const keep = hits.find((h) => sameArea({ ...value, postalCode: v }, h));
            onChange({
              postalCode: v,
              province: one('province'),
              district: keep?.district ?? one('district'),
              subDistrict: keep?.subDistrict ?? (hits.length === 1 ? hits[0].subDistrict : ''),
            });
          }}
        />
        {!disabled && !showZip && !zipUnknown && (
          <p className="form-hint">กรอกรหัสไปรษณีย์ ระบบเติมจังหวัด อำเภอ และตำบลให้ — ถ้าผิดกด “ล้างที่อยู่”</p>
        )}
        {zipUnknown && (
          <p className="form-hint" style={{ color: 'var(--color-warning)' }}>
            ไม่พบรหัสไปรษณีย์นี้ในรายการ — ตรวจตัวเลขอีกครั้ง หรือกรอกตำบล/อำเภอ/จังหวัดเองด้านล่าง
          </p>
        )}
        {showZip && (
          <AreaChoices
            heading={`รหัส ${zip} มีหลายตำบล — แตะเลือกตำบลของคุณ`}
            rows={zipHits}
            onPick={pick}
            showZip={false}
          />
        )}
      </div>

      <div style={showName ? { gridColumn: '1 / -1' } : undefined}>
        <label className="form-label" htmlFor={subId}>{bangkok ? 'แขวง' : 'ตำบล / แขวง'}</label>
        <input
          id={subId}
          className="form-input"
          autoComplete="off"
          placeholder="ไม่ทราบรหัสไปรษณีย์? พิมพ์ชื่อตำบล"
          value={value.subDistrict ?? ''}
          disabled={disabled}
          onChange={(e) => { onChange({ subDistrict: e.target.value }); setNameTyped(true); }}
        />
        {showName && (
          <AreaChoices
            heading="ตำบลที่ตรงกับที่พิมพ์ — แตะเพื่อเติมอำเภอ จังหวัด และรหัสไปรษณีย์"
            rows={nameHits}
            onPick={pick}
            onDismiss={() => setNameTyped(false)}
            showZip
          />
        )}
      </div>

      <div>
        <label className="form-label" htmlFor={disId}>{bangkok ? 'เขต' : 'อำเภอ / เขต'}</label>
        <input
          id={disId}
          className="form-input"
          autoComplete="off"
          value={value.district ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ district: e.target.value })}
        />
      </div>

      {disabled ? (
        <div>
          <label className="form-label">จังหวัด</label>
          <input className="form-input" value={value.province ?? ''} disabled readOnly />
        </div>
      ) : (
        <Combo
          label="จังหวัด"
          value={value.province}
          onChange={(v) => onChange({ province: v })}
          options={PROVINCE_OPTIONS}
        />
      )}
    </>
  );
}

/**
 * The matches as full-width rows in the page itself — not a floating list, so
 * nothing covers the next field and nothing can be scrolled out from under a
 * finger. Long lists show the first few with "แสดงเพิ่ม".
 */
function AreaChoices({
  heading,
  rows,
  onPick,
  onDismiss,
  showZip,
}: {
  heading: string;
  rows: AddressArea[];
  onPick: (r: AddressArea) => void;
  onDismiss?: () => void;
  showZip: boolean;
}) {
  const [all, setAll] = useState(false);
  const FIRST = 8;
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <div className="addr-choices" role="group" aria-label={heading}>
      <div className="addr-choices-head">
        <span>{heading}</span>
        {onDismiss && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>ปิด</button>
        )}
      </div>
      {shown.map((r) => (
        <button
          key={`${r.subDistrict}|${r.district}|${r.province}|${r.postalCode}`}
          type="button"
          className="addr-choice"
          onClick={() => onPick(r)}
        >
          <span className="addr-choice-main">{r.subDistrict}</span>
          <span className="addr-choice-sub">
            {r.district} · {r.province}{showZip ? ` · ${r.postalCode}` : ''}
          </span>
        </button>
      ))}
      {!all && rows.length > FIRST && (
        <button type="button" className="addr-choice addr-choice-more" onClick={() => setAll(true)}>
          แสดงอีก {rows.length - FIRST} ตำบล
        </button>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { formatThaiDate, isoToThai, thaiToIso, todayThai } from '@/lib/thai';

/**
 * Date input for every ว/ด/ป field in the module.
 *
 * The database keeps raw Buddhist-era text ("31/03/2569") for fidelity with the
 * source spreadsheets, and until now the UI asked people to type that by hand —
 * a free-text field where 3/13/2569 or a Gregorian year passes validation and
 * lands in the record. This wraps a native `<input type="date">` instead: the
 * browser renders its own calendar (Thai locales render it in พ.ศ.), and the
 * value is converted back to dd/mm/BBBB on the way out, so nothing about the
 * stored format changes.
 *
 * Legacy rows hold text a picker cannot represent ("2566", "-", a half-typed
 * date). Blanking those on open would destroy data, so an unparseable value
 * falls back to a plain text box with a note; the picker is one click away.
 */
export function DateField({
  label,
  value,
  onChange,
  required = false,
  hint,
  today = false,
  style,
  inputStyle,
}: {
  label?: string;
  value: string | null | undefined;
  /** Emits the raw Thai form "dd/mm/BBBB", or '' when cleared. */
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
  /** Show a "วันนี้" shortcut beside the field. */
  today?: boolean;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}) {
  const raw = value ?? '';
  const iso = thaiToIso(raw);
  const unparseable = raw.trim() !== '' && iso === null;
  const [rawMode, setRawMode] = useState(false);
  const asText = rawMode || unparseable;

  return (
    <div style={style}>
      {label && <label className={`form-label${required ? ' required' : ''}`}>{label}</label>}
      <div className="row" style={{ gap: 8 }}>
        {asText ? (
          <input
            className="form-input"
            style={{ width: 160, ...inputStyle }}
            placeholder="เช่น 31/03/2569"
            value={raw}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            type="date"
            className="form-input"
            style={{ width: 176, ...inputStyle }}
            value={iso ?? ''}
            onChange={(e) => onChange(isoToThai(e.target.value))}
          />
        )}
        {today && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(todayThai())}>
            วันนี้
          </button>
        )}
      </div>
      {unparseable ? (
        <p className="form-hint" style={{ color: 'var(--color-warning)' }}>
          รูปแบบวันที่เดิมไม่ถูกต้อง — แก้เป็น ว/ด/ปพ.ศ. เช่น 31/03/2569 แล้วจะเลือกจากปฏิทินได้
        </p>
      ) : (
        <p className="form-hint">
          {raw ? formatThaiDate(raw) : 'เลือกจากปฏิทิน (บันทึกเป็น พ.ศ.)'}
          {rawMode ? (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => setRawMode(false)}
                style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--skdw-purple)', cursor: 'pointer' }}
              >
                ใช้ปฏิทิน
              </button>
            </>
          ) : (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => setRawMode(true)}
                style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--skdw-purple)', cursor: 'pointer' }}
              >
                พิมพ์เอง
              </button>
            </>
          )}
        </p>
      )}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

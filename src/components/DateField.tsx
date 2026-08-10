'use client';

import { useRef, useState } from 'react';
import { IconCalendar } from './Icons';
import { ThaiCalendar } from './ThaiCalendar';
import { formatThaiDate, isoToThai, normalizeThaiInput, thaiDateParts, thaiToIso, todayThai } from '@/lib/thai';

/**
 * Date input for every ว/ด/ป field in the module.
 *
 * The database keeps raw Buddhist-era text ("31/03/2569") for fidelity with the
 * source spreadsheets. This used to be a free-text box, then a native
 * `<input type="date">` — but the native picker draws the browser's calendar,
 * which here is Gregorian: staff entering a birth date were shown 2011 and had
 * to subtract 543 in their heads. It now opens {@link ThaiCalendar}, a พ.ศ.
 * calendar, and the stored format is unchanged either way.
 *
 * The box itself stays typeable, because clicking back seventy years for a
 * birth date is worse than typing it. Whatever is typed is tidied on blur —
 * "3-4-69", "3/4/2026" and "03042569" all land as 03/04/2569 — and a value that
 * is not a real date is kept as-is and flagged rather than silently dropped,
 * which is also how legacy rows ("2566", "-") survive being opened.
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
  const parts = thaiDateParts(raw);
  const unparseable = raw.trim() !== '' && !parts;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div style={style}>
      {label && <label className={`form-label${required ? ' required' : ''}`}>{label}</label>}
      <div className="row" style={{ gap: 8 }}>
        <div ref={wrapRef} style={{ position: 'relative' }}>
          <input
            className="form-input"
            style={{ width: 160, paddingRight: 34, ...inputStyle }}
            inputMode="numeric"
            placeholder="ว/ด/ป เช่น 31/03/2569"
            aria-label={label}
            value={raw}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => onChange(normalizeThaiInput(raw))}
          />
          <button
            type="button"
            aria-label="เลือกจากปฏิทิน พ.ศ."
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              display: 'grid', placeItems: 'center', width: 24, height: 24,
              border: 'none', background: 'none', padding: 0,
              color: 'var(--skdw-muted)', cursor: 'pointer',
            }}
          >
            <IconCalendar width={16} height={16} />
          </button>
          {open && (
            <ThaiCalendar
              anchorRef={wrapRef}
              value={raw}
              onPick={onChange}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
        {today && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(todayThai())}>
            วันนี้
          </button>
        )}
      </div>
      {unparseable ? (
        <p className="form-hint" style={{ color: 'var(--color-warning)' }}>
          ยังไม่เป็นวันที่ที่ถูกต้อง — พิมพ์ ว/ด/ป พ.ศ. เช่น 31/03/2569 หรือเลือกจากปฏิทิน
        </p>
      ) : (
        <p className="form-hint">{raw ? formatThaiDate(raw) : 'พิมพ์ หรือเลือกจากปฏิทิน (พ.ศ.)'}</p>
      )}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

/**
 * Same field for the columns that are a real SQL `date` — ปีการศึกษา term dates,
 * an API key's วันหมดอายุ — where the value on the wire has to stay
 * "YYYY-MM-DD". Staff still pick and read พ.ศ.; only the conversion differs.
 *
 * Half-typed text has no ISO form, so it is held locally until it becomes a
 * date; the parent sees '' until then, which is what an empty date column
 * wants anyway.
 */
export function IsoDateField({
  value,
  onChange,
  ...rest
}: Omit<Parameters<typeof DateField>[0], 'value' | 'onChange'> & {
  /** "YYYY-MM-DD" (Gregorian), or '' when unset. */
  value: string | null | undefined;
  onChange: (iso: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <DateField
      {...rest}
      value={draft ?? isoToThai(value ?? '')}
      onChange={(raw) => {
        const iso = raw.trim() === '' ? '' : thaiToIso(raw);
        setDraft(iso ? null : raw);
        onChange(iso ?? '');
      }}
    />
  );
}

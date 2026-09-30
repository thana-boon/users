'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A short list of answers laid out as tap targets — one tap, no list to open.
 * For fields with a handful of options (ระดับการศึกษา, ประเภทลูกเสือ, เพศ);
 * anything longer belongs in {@link Combo}.
 *
 * Like Combo it never refuses an answer: "อื่น ๆ" opens a text box, and a saved
 * value that is not one of the options (a legacy spelling, an old วุฒิ) shows
 * there, selected, rather than disappearing. Tapping the selected chip again
 * clears it.
 */
export function ChoiceChips({
  label,
  value,
  onChange,
  options,
  required = false,
  allowOther = true,
  otherPlaceholder = 'พิมพ์คำตอบ',
  error,
  hint,
  style,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: readonly string[];
  required?: boolean;
  allowOther?: boolean;
  otherPlaceholder?: string;
  error?: string;
  hint?: string;
  style?: React.CSSProperties;
}) {
  const id = useId();
  const text = (value ?? '').trim();
  const isListed = options.includes(text);
  const [other, setOther] = useState(text !== '' && !isListed);
  const otherRef = useRef<HTMLInputElement>(null);
  const focusOther = useRef(false);

  // A value set from outside (a reset, a cancelled edit) decides the mode again.
  useEffect(() => {
    if (isListed) setOther(false);
    else if (text) setOther(true);
  }, [isListed, text]);

  useEffect(() => {
    if (other && focusOther.current) {
      focusOther.current = false;
      otherRef.current?.focus();
    }
  }, [other]);

  return (
    <div style={{ gridColumn: '1 / -1', ...style }}>
      <div id={id} className={`form-label${required ? ' required' : ''}`}>{label}</div>
      <div
        className={`choice-chips${error ? ' error' : ''}`}
        role="radiogroup"
        aria-labelledby={id}
        aria-invalid={error ? true : undefined}
      >
        {options.map((o) => {
          const on = !other && o === text;
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={on}
              className="choice-chip"
              onClick={() => { setOther(false); onChange(on ? '' : o); }}
            >
              {o}
            </button>
          );
        })}
        {allowOther && (
          <button
            type="button"
            role="radio"
            aria-checked={other}
            className="choice-chip"
            onClick={() => {
              if (other) { setOther(false); onChange(''); return; }
              focusOther.current = true;
              setOther(true);
              if (isListed) onChange('');
            }}
          >
            อื่น ๆ
          </button>
        )}
      </div>
      {other && (
        <input
          ref={otherRef}
          className={`form-input${error ? ' error' : ''}`}
          style={{ marginTop: 8 }}
          aria-label={`${label} (อื่น ๆ)`}
          autoComplete="off"
          placeholder={otherPlaceholder}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && <p className="form-error">{error}</p>}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

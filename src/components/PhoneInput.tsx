'use client';

import { normalizePhone, phoneWarning } from '@/lib/phone';

/**
 * A field that can only ever hold a phone number.
 *
 * Two things happen here that a plain text input does not do:
 *
 * 1. NON-DIGITS NEVER LAND. Typing, pasting or autofilling `089-885-0863`
 *    leaves `0898850863` in the box. The server normalizes the same way on
 *    save (lib/phone.ts), so this is not the guarantee — it is the part the
 *    person can see. A field that silently rewrites its value on save is a
 *    field people stop trusting; a field that never accepted the character in
 *    the first place explains itself.
 *
 * 2. AN ODD LENGTH IS QUESTIONED, NOT REFUSED. 9 digits (เบอร์บ้าน) and 10
 *    (มือถือ) pass quietly; anything else gets a line underneath asking the
 *    person to look again. Refusing the save would be worse — the office would
 *    be left with a blank field instead of a questionable one, and the school
 *    does occasionally hold a number that is genuinely unusual. See
 *    phoneWarning() for why 13 digits gets its own sentence.
 *
 * `inputMode="tel"` so a phone keyboard comes up on a mobile; `type` stays
 * text, because `type="number"` brings spinners, exponent notation, and a
 * leading zero that some browsers eat — on a field where `08…` is the whole
 * point.
 */
export function PhoneInput({
  label,
  value,
  onChange,
  placeholder = 'เช่น 0812345678',
  hint,
  disabled = false,
  wide = false,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  wide?: boolean;
}) {
  const warn = phoneWarning(value);

  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label">{label}</label>
      <input
        className="form-input mono"
        value={value ?? ''}
        inputMode="tel"
        autoComplete="tel"
        placeholder={placeholder}
        disabled={disabled}
        // The filter runs on every change, so a paste is cleaned the same way
        // a keystroke is. '' is passed through rather than turned into null:
        // an empty box means "clearing this", which the save layer reads.
        onChange={(e) => onChange(normalizePhone(e.target.value) ?? '')}
      />
      {warn ? (
        <p className="form-hint" style={{ color: 'var(--color-warning)' }}>
          {warn}
        </p>
      ) : (
        hint && <p className="form-hint">{hint}</p>
      )}
    </div>
  );
}

/** True when a field name in one of the generic field maps holds a phone number. */
export function isPhoneKey(key: string): boolean {
  return /phone$/i.test(key);
}

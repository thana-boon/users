'use client';

import { useId, useState } from 'react';
import { api } from '@/lib/client';
import { IconEye, IconLock, IconUnlock } from '@/components/Icons';

/**
 * Small pieces shared by the teacher and student versions of "ข้อมูลของฉัน".
 *
 * The important one is {@link Locked}: a registry field is SHOWN, greyed, with
 * one line saying who to ask. Hiding it would be worse — someone checking
 * whether the office has their surname right should be able to see it here, and
 * know at a glance why they cannot fix it themselves.
 */

/**
 * A field the person owns. Greyed out when the school has closed the window.
 *
 * Most people fill this page in on a phone, so each field says which keyboard
 * it wants (`inputMode` / `type`) and what the browser may autofill — typing a
 * postcode on a full QWERTY keyboard is the kind of friction that gets a form
 * abandoned half-way.
 */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled = false,
  wide = false,
  inputMode,
  type = 'text',
  autoComplete,
  maxLength,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  wide?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  type?: 'text' | 'email';
  autoComplete?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="form-input"
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        autoComplete={autoComplete ?? 'off'}
        autoCapitalize={type === 'email' ? 'none' : undefined}
        maxLength={maxLength}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <p className="form-hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

/** A registry field: shown, explained, never editable here. */
export function Locked({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | null | undefined;
  wide?: boolean;
}) {
  const id = useId();
  // Read-only, not disabled: the value is real and should read (and copy) as
  // such. The lock says "not yours to change" without leaning on grey alone.
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label" htmlFor={id}>
        {label}
        <IconLock width={12} height={12} className="form-label-icon" />
        <span className="sr-only"> (แก้ไขเองไม่ได้)</span>
      </label>
      <input id={id} className="form-input" value={value?.trim() || '—'} readOnly aria-readonly />
    </div>
  );
}

/** The card wrapper every block on the page uses. */
export function Section({
  title,
  hint,
  badge,
  children,
}: {
  title: string;
  hint?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card me-section" aria-label={title}>
      <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
        <h2 className="section-title" style={{ marginBottom: hint ? 2 : 0 }}>{title}</h2>
        {badge}
      </div>
      {hint && <p className="me-section-hint">{hint}</p>}
      <div className="grid-2 me-fields" style={{ marginTop: hint ? 0 : 12 }}>{children}</div>
    </section>
  );
}

/**
 * The banner that replaces the save bar when editing is closed. It says which
 * of the two reasons applies, because "the school closed the window" and "you
 * have left" want different next steps from the reader.
 */
export function ClosedNotice({
  reason,
  canChangePassword = true,
}: {
  reason: string;
  /** False for teachers — only an admin sets a staff password. */
  canChangePassword?: boolean;
}) {
  return (
    <div className="alert alert-info" style={{ lineHeight: 1.8 }}>
      {reason}
      <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
        {canChangePassword
          ? 'ข้อมูลด้านบนยังเปิดดูได้ตามปกติ และเปลี่ยนรหัสผ่านของตนเองได้เสมอ'
          : 'ข้อมูลด้านบนยังเปิดดูได้ตามปกติ'}
      </div>
    </div>
  );
}

/** The sticky save bar. Absent entirely when there is nothing to save. */
export function SaveBar({
  busy,
  onSave,
  label = 'บันทึกข้อมูลของฉัน',
  hint,
  dirty = false,
}: {
  busy: boolean;
  onSave: () => void;
  label?: string;
  hint?: string;
  /** Edits on the page nobody has saved yet — says so next to the button. */
  dirty?: boolean;
}) {
  // Sticky rather than fixed: it rides at the bottom of the screen while the
  // form scrolls under it, then settles into place above the lists it does not
  // cover. On a phone the button fills the bar — the one thing a thumb aims for.
  return (
    <div className="me-savebar" data-dirty={dirty || undefined}>
      <div className="me-savebar-status" aria-live="polite">
        {busy ? null : dirty ? (
          <span className="badge badge-warning">ยังไม่ได้บันทึก</span>
        ) : (
          <span className="muted">ไม่มีการเปลี่ยนแปลง</span>
        )}
        {hint && <span className="muted me-savebar-hint">{hint}</span>}
      </div>
      <button className="btn btn-primary me-savebar-btn" onClick={onSave} disabled={busy} aria-busy={busy}>
        {busy ? 'กำลังบันทึก…' : label}
      </button>
    </div>
  );
}

/**
 * เลขบัตรประชาชน on one's own record — the one field governed by the school-wide
 * sensitive switch (/users/settings).
 *
 * Three states, and the component is the only place that knows which is which:
 *
 *  1. Switch off — a {@link Locked} field showing the masked number, with the
 *     admin's line about who to ask. Identical to every other registry field,
 *     because as far as this person is concerned it IS one.
 *  2. Switch on, not yet revealed — the masked number plus a "ดูเลขเต็ม" button.
 *     Nothing is decrypted until that click, and the click is audited, so the
 *     number is not sitting in the page for anyone walking past a logged-in
 *     phone. Same bargain as the admin RevealButton.
 *  3. Switch on, revealed — the full number, read-only, behind a second
 *     latch before it becomes typeable. Two deliberate clicks between "I opened
 *     my profile" and "I changed my national id", because the stored value is
 *     ciphertext: a typo here is invisible the moment it is saved and nobody
 *     can eyeball the column later to find it.
 *
 * Locking again discards the draft and reports `undefined` upward, so the key
 * leaves the PATCH payload entirely — a latch flicked by accident cannot leave
 * a half-typed number queued for the next บันทึก.
 */
export function CitizenIdField({
  masked,
  canEdit,
  closedReason,
  onChange,
  wide = false,
}: {
  masked: string | null;
  /** Both the audience window AND the sensitive switch — the route's canEditSensitive. */
  canEdit: boolean;
  /** Why it is locked, when it is. Shown as the hint under a locked field. */
  closedReason: string | null;
  /** `undefined` = leave this field out of the save entirely. */
  onChange: (value: string | null | undefined) => void;
  wide?: boolean;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ value: string | null }>('/api/users/me/reveal', { method: 'POST' });
      setRevealed(res.value ?? '');
      setDraft(res.value ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function relock() {
    setUnlocked(false);
    setDraft(revealed ?? '');
    onChange(undefined);
  }

  const shown = revealed ?? masked;
  const id = useId();

  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label" htmlFor={id}>
        เลขบัตรประชาชน
        {!unlocked && <IconLock width={12} height={12} className="form-label-icon" />}
      </label>

      {unlocked ? (
        <input
          id={id}
          className="form-input mono"
          value={draft}
          inputMode="numeric"
          autoComplete="off"
          maxLength={17}
          placeholder="กรอก 13 หลัก"
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            // '' is a real instruction — "I have no number on file" — so it is
            // sent as an empty string rather than dropped as "no change".
            onChange(v);
          }}
        />
      ) : (
        <input id={id} className="form-input mono" value={shown?.trim() || '—'} readOnly aria-readonly />
      )}

      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        {canEdit && revealed === null && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={reveal} disabled={busy}>
            <IconEye width={15} height={15} /> {busy ? 'กำลังถอดรหัส…' : 'ดูเลขเต็ม'}
          </button>
        )}
        {canEdit && revealed !== null && !unlocked && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUnlocked(true)}>
            <IconUnlock width={15} height={15} /> แก้ไขเลขนี้
          </button>
        )}
        {canEdit && unlocked && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={relock}>
            <IconLock width={15} height={15} /> ยกเลิกการแก้ไข
          </button>
        )}
      </div>

      <p className="form-hint">
        {error
          ? error
          : !canEdit
            ? (closedReason ?? 'ดูแบบเต็มและแก้ไขไม่ได้ หากไม่ถูกต้องให้แจ้งฝ่ายธุรการ')
            : unlocked
              ? 'ต้องเป็นเลข 13 หลักที่ถูกต้อง · เว้นว่าง = ลบเลขบัตรออกจากระบบ · บันทึกแล้วจะถูกเข้ารหัสไว้'
              : 'การกดดูเลขเต็มถูกบันทึกในบันทึกการใช้งานทุกครั้ง'}
      </p>
    </div>
  );
}

'use client';

import { useState } from 'react';
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

/** A field the person owns. Greyed out when the school has closed the window. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
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
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {hint && <p className="form-hint">{hint}</p>}
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
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label">{label}</label>
      <input className="form-input" value={value?.trim() || '—'} disabled readOnly />
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
    <div className="card">
      <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
        <h2 className="section-title" style={{ marginBottom: hint ? 2 : 0 }}>{title}</h2>
        {badge}
      </div>
      {hint && <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>{hint}</p>}
      <div className="grid-2" style={{ gap: 12, marginTop: hint ? 0 : 12 }}>{children}</div>
    </div>
  );
}

/**
 * The banner that replaces the save bar when editing is closed. It says which
 * of the two reasons applies, because "the school closed the window" and "you
 * have left" want different next steps from the reader.
 */
export function ClosedNotice({ reason }: { reason: string }) {
  return (
    <div className="alert alert-info" style={{ lineHeight: 1.8 }}>
      {reason}
      <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
        ข้อมูลด้านบนยังเปิดดูได้ตามปกติ และเปลี่ยนรหัสผ่านของตนเองได้เสมอ
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
}: {
  busy: boolean;
  onSave: () => void;
  label?: string;
  hint?: string;
}) {
  return (
    <div className="card" style={{ position: 'sticky', bottom: 16, zIndex: 50 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={onSave} disabled={busy}>
          {busy ? 'กำลังบันทึก…' : label}
        </button>
        {hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
      </div>
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

  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label">เลขบัตรประชาชน</label>

      {unlocked ? (
        <input
          className="form-input mono"
          value={draft}
          inputMode="numeric"
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
        <input className="form-input mono" value={shown?.trim() || '—'} disabled readOnly />
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

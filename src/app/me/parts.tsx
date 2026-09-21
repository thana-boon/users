'use client';

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

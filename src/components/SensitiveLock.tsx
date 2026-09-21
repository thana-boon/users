'use client';

import { IconLock, IconUnlock } from './Icons';

/**
 * The switch that guards เลขบัตรประชาชน / รหัสผ่าน / รายได้ผู้ปกครอง.
 *
 * Those fields are encrypted at rest, every reveal is audited, and a typo in
 * one is invisible afterwards — the stored value is a cipher text nobody can
 * eyeball. So they start locked on every edit, even for an admin who is
 * allowed to change them: the permission is not in question, the intent is.
 *
 * Locking again clears whatever was typed, so a switch flicked by accident
 * cannot leave a half-typed เลขบัตร waiting for the next บันทึก. The page is
 * expected to drop those keys from the payload while locked, too — the switch
 * is a statement of intent, not only a disabled attribute.
 */
export function SensitiveLock({
  unlocked,
  onChange,
  hint = 'ค่าที่กรอกจะถูกเข้ารหัสและบันทึกลงประวัติการใช้งาน',
}: {
  unlocked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <div
      className="row-between"
      style={{
        gap: 12,
        padding: '10px 12px',
        borderRadius: 'var(--radius-sm)',
        background: unlocked ? 'var(--color-warning-bg)' : 'var(--skdw-bg)',
        border: '0.5px solid var(--skdw-border)',
        marginBottom: 12,
      }}
    >
      <div className="row" style={{ gap: 8, minWidth: 200, flex: 1 }}>
        <span style={{ color: unlocked ? 'var(--color-warning)' : 'var(--skdw-muted)' }}>
          {unlocked ? <IconUnlock width={18} height={18} /> : <IconLock width={18} height={18} />}
        </span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {unlocked ? 'แก้ไขข้อมูลอ่อนไหวได้' : 'ล็อกไว้ — แก้ไขไม่ได้'}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {unlocked ? hint : 'เปิดสวิตช์นี้ก่อนจึงจะพิมพ์แก้ไขได้ กันการแก้โดยไม่ตั้งใจ'}
          </div>
        </div>
      </div>
      <button
        type="button"
        className={`btn btn-sm ${unlocked ? 'btn-ghost' : 'btn-secondary'}`}
        onClick={() => onChange(!unlocked)}
        aria-pressed={unlocked}
      >
        {unlocked ? 'ล็อกอีกครั้ง' : 'เปิดให้แก้ไข'}
      </button>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { IconStudents, IconTeachers } from '@/components/Icons';

/**
 * ตั้งค่าระบบ — the school-wide switches.
 *
 * Today that is one question asked of two audiences: may ครู / นักเรียน edit
 * their own record right now? Kept separate because the school opens the two
 * windows at different times — staff file their new วุฒิ in May, pupils update
 * ข้อมูลสุขภาพ in the first week of term.
 *
 * Each switch takes effect within a few seconds everywhere (see the cache in
 * services/settings.ts), and closing a window never locks anyone out of
 * changing their own password — that is a security control, not a record edit.
 */

interface Settings {
  selfEditTeachers: boolean;
  selfEditStudents: boolean;
}

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<keyof Settings | null>(null);

  useEffect(() => {
    api<Settings>('/api/users/settings')
      .then(setS)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!s) return <div className="skeleton" style={{ height: 220 }} />;

  async function toggle(key: keyof Settings, next: boolean) {
    setBusy(key);
    try {
      const res = await api<Settings>('/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: next }),
      });
      setS(res);
      toast(next ? 'เปิดให้แก้ไขข้อมูลตนเองแล้ว' : 'ปิดการแก้ไขข้อมูลตนเองแล้ว', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 760 }}>
      <div>
        <h1 className="page-title">ตั้งค่าระบบ</h1>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
          เปิด-ปิดหน้าต่างให้ครูและนักเรียนแก้ไขข้อมูลของตนเองที่หน้า “ข้อมูลของฉัน”
        </p>
      </div>

      <SwitchCard
        title="ให้ครูแก้ไขข้อมูลของตนเองได้"
        Icon={IconTeachers}
        on={s.selfEditTeachers}
        busy={busy === 'selfEditTeachers'}
        onToggle={(v) => toggle('selfEditTeachers', v)}
        openText="ครูแก้ได้: เบอร์โทร · ไอดีไลน์ · เพศ/ศาสนา/สัญชาติ/เชื้อชาติ · รูปของตนเอง · วุฒิการศึกษา · วุฒิลูกเสือ · ประวัติการอบรม"
        closedText="ขณะนี้ครูเปิดดูข้อมูลของตนเองได้อย่างเดียว แก้ไขไม่ได้ — ชื่อ-สกุล อีเมล วันเกิด เลขบัตร กลุ่มสาระ และสิทธิ์ ยังคงเป็นของผู้ดูแลเสมอไม่ว่าสวิตช์นี้จะเปิดหรือปิด"
      />

      <SwitchCard
        title="ให้นักเรียนแก้ไขข้อมูลของตนเองได้"
        Icon={IconStudents}
        on={s.selfEditStudents}
        busy={busy === 'selfEditStudents'}
        onToggle={(v) => toggle('selfEditStudents', v)}
        openText="นักเรียนแก้ได้: เบอร์โทร · ชื่อเล่น · ข้อมูลสุขภาพ (น้ำหนัก ส่วนสูง กรุ๊ปเลือด การแพ้ โรคประจำตัว) · ที่อยู่ปัจจุบันและผู้ติดต่อฉุกเฉิน"
        closedText="ขณะนี้นักเรียนเปิดดูข้อมูลของตนเองได้อย่างเดียว แก้ไขไม่ได้ — ชื่อ-สกุล วันเกิด เลขบัตร ที่อยู่ตามทะเบียนบ้าน ผู้ปกครอง ชั้น/ห้อง และรูปติดบัตร เป็นของผู้ดูแลเสมอไม่ว่าสวิตช์นี้จะเปิดหรือปิด"
      />

      <div className="card">
        <h2 className="section-title">หมายเหตุ</h2>
        <ul className="muted" style={{ fontSize: 13, margin: 0, paddingInlineStart: 20, lineHeight: 1.9 }}>
          <li>การแก้ไขทุกครั้งถูกบันทึกใน “บันทึกการใช้งาน” ว่าเป็นการแก้ไขข้อมูลตนเอง</li>
          <li>การเปลี่ยนรหัสผ่านของตนเอง <b>ทำได้เสมอ</b> แม้ปิดสวิตช์ (ต้องยืนยันรหัสผ่านเดิม)</li>
          <li>ครู/นักเรียนที่ลาออกหรือจบการศึกษาแล้ว ดูข้อมูลได้แต่แก้ไม่ได้ ไม่ว่าสวิตช์จะเปิดหรือปิด</li>
        </ul>
      </div>
    </div>
  );
}

function SwitchCard({
  title, Icon, on, busy, onToggle, openText, closedText,
}: {
  title: string;
  Icon: typeof IconTeachers;
  on: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
  openText: string;
  closedText: string;
}) {
  return (
    <div className="card">
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start', flex: 1, minWidth: 220 }}>
          <span style={{ color: 'var(--skdw-purple)', marginTop: 2 }}>
            <Icon width={22} height={22} />
          </span>
          <div>
            <div style={{ fontWeight: 600 }}>{title}</div>
            <span className={`badge ${on ? 'badge-success' : 'badge-muted'}`} style={{ marginTop: 6 }}>
              {on ? 'เปิดอยู่' : 'ปิดอยู่'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}`}
          onClick={() => onToggle(!on)}
          disabled={busy}
          aria-pressed={on}
        >
          {busy ? 'กำลังบันทึก…' : on ? 'ปิดการแก้ไข' : 'เปิดการแก้ไข'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '12px 0 0', lineHeight: 1.8 }}>
        {on ? openText : closedText}
      </p>
    </div>
  );
}

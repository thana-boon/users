'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { RevealButton } from '@/components/RevealButton';
import { EmploymentStatusDialog } from '@/components/EmploymentStatusDialog';
import { PhotoCard } from '@/components/PhotoCard';
import { IconBack, IconTrash } from '@/components/Icons';
import { Combo } from '@/components/Combo';
import { SubjectGroupSelect } from '@/components/SubjectGroupSelect';
import { DateField } from '@/components/DateField';
import {
  GENDER_OPTIONS, RELIGION_OPTIONS, NATIONALITY_OPTIONS, ETHNICITY_OPTIONS,
  STAFF_PREFIX_OPTIONS,
} from '@/lib/options';

interface Detail {
  id: number; teacherCode: string; prefix: string | null;
  firstName: string; lastName: string; email: string | null;
  phone: string | null; lineId: string | null; birthDate: string | null;
  subjectGroup: string | null; gradeTaught: string | null; role: string;
  gender: string | null; religion: string | null;
  nationality: string | null; ethnicity: string | null;
  citizenIdMasked: string | null; hasCitizenId: boolean; hasPassword: boolean;
  hasPhoto: boolean;
  employmentStatus: 'active' | 'resigned';
  exitDate: string | null; exitReason: string | null; exitAcademicYearId: number | null;
}

export default function TeacherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Detail> & { password?: string; citizenId?: string }>({});
  const [busy, setBusy] = useState(false);
  const [showResign, setShowResign] = useState(false);

  function load() {
    api<Detail>(`/api/users/teachers/${id}`).then((x) => { setD(x); setForm(x); }).catch((e) => setError(e.message));
  }
  useEffect(load, [id]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!d) return <div className="skeleton" style={{ height: 200 }} />;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));
  const setV = (k: string) => (v: string) => setForm((s) => ({ ...s, [k]: v }));

  const initials = `${d.firstName?.[0] ?? ''}${d.lastName?.[0] ?? ''}`.trim();
  const resigned = d.employmentStatus === 'resigned';

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        prefix: form.prefix, firstName: form.firstName, lastName: form.lastName,
        email: form.email, phone: form.phone, lineId: form.lineId, birthDate: form.birthDate,
        subjectGroup: form.subjectGroup, gradeTaught: form.gradeTaught,
        gender: form.gender, religion: form.religion,
        nationality: form.nationality, ethnicity: form.ethnicity,
        role: form.role,
      };
      if (form.password) payload.password = form.password;
      if (form.citizenId && form.citizenId.trim()) payload.citizenId = form.citizenId.trim();
      await api(`/api/users/teachers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('บันทึกแล้ว', 'success');
      setForm((s) => ({ ...s, password: '', citizenId: '' }));
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  async function reinstate() {
    if (!(await confirm({
      title: 'คืนสถานะทำงาน',
      message: 'ตั้งสถานะครูคนนี้กลับเป็น “ทำงานอยู่”? ข้อมูลการลาออก (วันที่/ปี/เหตุผล) จะถูกล้าง',
      confirmText: 'คืนสถานะทำงาน',
    }))) return;
    try {
      await api(`/api/users/teachers/${id}/status`, jsonBody({ status: 'active' }));
      toast('คืนสถานะทำงานแล้ว', 'success');
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function archive() {
    if (!(await confirm({
      title: 'ย้ายไปถังขยะ',
      message: 'ย้ายครูคนนี้ไปถังขยะ? ข้อมูลจะไม่หาย แต่จะไม่แสดงในรายการ — กู้คืนได้ที่หน้าถังขยะ',
      confirmText: 'ย้ายไปถังขยะ',
      danger: true,
    }))) return;
    try {
      await api(`/api/users/teachers/${id}`, { method: 'DELETE' });
      toast('ย้ายไปถังขยะแล้ว', 'success');
      router.push('/users/teachers');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 720 }}>
      <div className="row-between">
        <Link href="/users/teachers" className="btn btn-ghost btn-sm"><IconBack width={16} height={16} /> กลับรายชื่อ</Link>
        <button className="btn btn-danger btn-sm" onClick={archive}><IconTrash width={16} height={16} /> ย้ายไปถังขยะ</button>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <PhotoCard
            baseEndpoint={`/api/users/teachers/${id}/photo`}
            hasPhoto={d.hasPhoto}
            initials={initials}
            alt="รูปครู"
            onChange={(has) => setD((s) => (s ? { ...s, hasPhoto: has } : s))}
          />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <div>
                <h1 className="page-title">{d.prefix}{d.firstName} {d.lastName}</h1>
                <p className="muted mono" style={{ margin: '4px 0 0' }}>{d.teacherCode}</p>
              </div>
              <span className={`badge ${d.role === 'teacher-admin' ? 'badge-gold' : 'badge-muted'}`} style={{ padding: '6px 12px' }}>{d.role}</span>
            </div>

            <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`badge ${resigned ? 'badge-muted' : 'badge-success'}`} style={{ padding: '6px 12px' }}>
                {resigned ? 'ลาออกแล้ว' : 'ทำงานอยู่'}
              </span>
              {resigned && (
                <span className="muted" style={{ fontSize: 13 }}>
                  ออกเมื่อ {d.exitDate ?? '-'}{d.exitReason ? ` · ${d.exitReason}` : ''}
                </span>
              )}
              {resigned
                ? <button className="btn btn-ghost btn-sm" onClick={reinstate}>คืนสถานะทำงาน</button>
                : <button className="btn btn-ghost btn-sm" onClick={() => setShowResign(true)}>บันทึกลาออก</button>}
            </div>
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '0.5px solid var(--skdw-border)', margin: '16px 0' }} />

        <div className="grid-2" style={{ gap: 12 }}>
          <Combo label="คำนำหน้า" value={form.prefix} onChange={setV('prefix')} options={STAFF_PREFIX_OPTIONS} />
          <div><label className="form-label">อีเมล</label><input className="form-input" value={form.email ?? ''} onChange={set('email')} /></div>
          <div><label className="form-label">ชื่อ</label><input className="form-input" value={form.firstName ?? ''} onChange={set('firstName')} /></div>
          <div><label className="form-label">นามสกุล</label><input className="form-input" value={form.lastName ?? ''} onChange={set('lastName')} /></div>
          <div><label className="form-label">เบอร์โทร</label><input className="form-input" value={form.phone ?? ''} onChange={set('phone')} placeholder="เช่น 0812345678" /></div>
          <div><label className="form-label">ไอดีไลน์</label><input className="form-input" value={form.lineId ?? ''} onChange={set('lineId')} placeholder="เช่น teacher.somchai" /></div>
          <DateField label="วันเดือนปีเกิด" value={form.birthDate} onChange={setV('birthDate')} />
          <Combo label="เพศ" value={form.gender} onChange={setV('gender')} options={GENDER_OPTIONS} />
          <Combo label="ศาสนา" value={form.religion} onChange={setV('religion')} options={RELIGION_OPTIONS} />
          <Combo label="สัญชาติ" value={form.nationality} onChange={setV('nationality')} options={NATIONALITY_OPTIONS} />
          <Combo label="เชื้อชาติ" value={form.ethnicity} onChange={setV('ethnicity')} options={ETHNICITY_OPTIONS} />
          <SubjectGroupSelect
            label="กลุ่มสาระที่สอน"
            value={form.subjectGroup}
            onChange={setV('subjectGroup')}
            hint="เลือกจากรายการกลุ่มสาระของโรงเรียน — แก้ไขรายการได้ที่หน้า “กลุ่มสาระ”"
            style={{ gridColumn: '1 / -1' }}
          />
          <div>
            <label className="form-label">สิทธิ์ (role)</label>
            <select className="form-select" value={form.role ?? 'teacher'} onChange={set('role')}>
              <option value="teacher">teacher</option>
              <option value="teacher-admin">teacher-admin</option>
            </select>
            <p className="form-hint">การเปลี่ยนเป็น teacher-admin ให้สิทธิ์เข้าโมดูลนี้</p>
          </div>
          <div><label className="form-label">ตั้งรหัสผ่านใหม่ (เว้นว่าง=ไม่เปลี่ยน)</label><input className="form-input" value={form.password ?? ''} onChange={set('password')} /></div>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">ข้อมูลอ่อนไหว (การดูจะถูกบันทึก)</h2>
        <div className="grid-2" style={{ gap: 16, alignItems: 'center' }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>เลขบัตรประชาชน</div>
            <div className="mono">{d.citizenIdMasked ?? <span className="muted">ไม่มี</span>}</div>
            {d.hasCitizenId && <div style={{ marginTop: 4 }}><RevealButton endpoint={`/api/users/teachers/${id}/reveal`} field="citizen_id" label="แสดงเลขเต็ม" /></div>}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>รหัสผ่าน</div>
            {d.hasPassword ? <RevealButton endpoint={`/api/users/teachers/${id}/reveal`} field="password" label="ดูรหัสผ่าน" /> : <span className="muted">ไม่มี</span>}
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">แก้ไขเลขบัตรประชาชน (เว้นว่าง=ไม่เปลี่ยน)</label>
            <input className="form-input mono" value={form.citizenId ?? ''} onChange={set('citizenId')} placeholder="เลข 13 หลัก" />
            <p className="form-hint">พิมพ์เลขใหม่แล้วกด “บันทึก” ด้านบน — ระบบจะเข้ารหัสและบันทึกการแก้ไข</p>
          </div>
        </div>
      </div>

      {showResign && (
        <EmploymentStatusDialog
          endpoint={`/api/users/teachers/${id}/status`}
          onClose={() => setShowResign(false)}
          onDone={() => { setShowResign(false); load(); }}
        />
      )}
    </div>
  );
}

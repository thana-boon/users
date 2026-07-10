'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { RevealButton } from '@/components/RevealButton';
import { IconBack } from '@/components/Icons';

interface Detail {
  id: number; teacherCode: string; prefix: string | null;
  firstName: string; lastName: string; email: string | null;
  subjectGroup: string | null; gradeTaught: string | null; role: string;
  citizenIdMasked: string | null; hasCitizenId: boolean; hasPassword: boolean;
}

export default function TeacherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Detail> & { password?: string }>({});
  const [busy, setBusy] = useState(false);

  function load() {
    api<Detail>(`/api/users/teachers/${id}`).then((x) => { setD(x); setForm(x); }).catch((e) => setError(e.message));
  }
  useEffect(load, [id]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!d) return <div className="skeleton" style={{ height: 200 }} />;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        prefix: form.prefix, firstName: form.firstName, lastName: form.lastName,
        email: form.email, subjectGroup: form.subjectGroup, gradeTaught: form.gradeTaught,
        role: form.role,
      };
      if (form.password) payload.password = form.password;
      await api(`/api/users/teachers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('บันทึกแล้ว', 'success');
      setForm((s) => ({ ...s, password: '' }));
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!(await confirm({
      title: 'ย้ายไปคลัง',
      message: 'ย้ายครูคนนี้ไปคลัง (archive)?',
      confirmText: 'ย้ายไปคลัง',
      danger: true,
    }))) return;
    try {
      await api(`/api/users/teachers/${id}`, { method: 'DELETE' });
      toast('ย้ายไปคลังแล้ว', 'success');
      router.push('/users/teachers');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 720 }}>
      <div className="row-between">
        <Link href="/users/teachers" className="btn btn-ghost btn-sm"><IconBack width={16} height={16} /> กลับรายชื่อ</Link>
        <button className="btn btn-danger btn-sm" onClick={archive}>ย้ายออก</button>
      </div>

      <div className="card">
        <div className="row-between">
          <div>
            <h1 className="page-title">{d.prefix}{d.firstName} {d.lastName}</h1>
            <p className="muted mono" style={{ margin: '4px 0 0' }}>{d.teacherCode}</p>
          </div>
          <span className={`badge ${d.role === 'teacher-admin' ? 'badge-gold' : 'badge-muted'}`} style={{ padding: '6px 12px' }}>{d.role}</span>
        </div>

        <hr style={{ border: 'none', borderTop: '0.5px solid var(--skdw-border)', margin: '16px 0' }} />

        <div className="grid-2" style={{ gap: 12 }}>
          <div><label className="form-label">คำนำหน้า</label><input className="form-input" value={form.prefix ?? ''} onChange={set('prefix')} /></div>
          <div><label className="form-label">อีเมล</label><input className="form-input" value={form.email ?? ''} onChange={set('email')} /></div>
          <div><label className="form-label">ชื่อ</label><input className="form-input" value={form.firstName ?? ''} onChange={set('firstName')} /></div>
          <div><label className="form-label">นามสกุล</label><input className="form-input" value={form.lastName ?? ''} onChange={set('lastName')} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label className="form-label">กลุ่มสาระที่สอน</label><input className="form-input" value={form.subjectGroup ?? ''} onChange={set('subjectGroup')} /></div>
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
        </div>
      </div>
    </div>
  );
}

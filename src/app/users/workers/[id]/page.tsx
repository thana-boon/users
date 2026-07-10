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

interface Detail {
  id: number; workerCode: string; prefix: string | null;
  firstName: string; lastName: string; position: string | null; phone: string | null;
  citizenIdMasked: string | null; hasCitizenId: boolean; hasPhoto: boolean;
  employmentStatus: 'active' | 'resigned';
  exitDate: string | null; exitReason: string | null; exitAcademicYearId: number | null;
}

export default function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Detail> & { citizenId?: string }>({});
  const [busy, setBusy] = useState(false);
  const [showResign, setShowResign] = useState(false);

  function load() {
    api<Detail>(`/api/users/workers/${id}`).then((x) => { setD(x); setForm(x); }).catch((e) => setError(e.message));
  }
  useEffect(load, [id]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!d) return <div className="skeleton" style={{ height: 200 }} />;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const initials = `${d.firstName?.[0] ?? ''}${d.lastName?.[0] ?? ''}`.trim();
  const resigned = d.employmentStatus === 'resigned';

  async function save() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        prefix: form.prefix, firstName: form.firstName, lastName: form.lastName,
        position: form.position, phone: form.phone,
      };
      if (form.citizenId && form.citizenId.trim()) payload.citizenId = form.citizenId.trim();
      await api(`/api/users/workers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('บันทึกแล้ว', 'success');
      setForm((s) => ({ ...s, citizenId: '' }));
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  async function reinstate() {
    if (!(await confirm({
      title: 'คืนสถานะทำงาน',
      message: 'ตั้งสถานะคนงานคนนี้กลับเป็น “ทำงานอยู่”? ข้อมูลการลาออก (วันที่/ปี/เหตุผล) จะถูกล้าง',
      confirmText: 'คืนสถานะทำงาน',
    }))) return;
    try {
      await api(`/api/users/workers/${id}/status`, jsonBody({ status: 'active' }));
      toast('คืนสถานะทำงานแล้ว', 'success');
      load();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function archive() {
    if (!(await confirm({
      title: 'ย้ายไปถังขยะ',
      message: 'ย้ายคนงานคนนี้ไปถังขยะ? ข้อมูลจะไม่หาย แต่จะไม่แสดงในรายการ',
      confirmText: 'ย้ายไปถังขยะ',
      danger: true,
    }))) return;
    try {
      await api(`/api/users/workers/${id}`, { method: 'DELETE' });
      toast('ย้ายไปถังขยะแล้ว', 'success');
      router.push('/users/workers');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 720 }}>
      <div className="row-between">
        <Link href="/users/workers" className="btn btn-ghost btn-sm"><IconBack width={16} height={16} /> กลับรายชื่อ</Link>
        <button className="btn btn-danger btn-sm" onClick={archive}><IconTrash width={16} height={16} /> ย้ายไปถังขยะ</button>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <PhotoCard
            baseEndpoint={`/api/users/workers/${id}/photo`}
            hasPhoto={d.hasPhoto}
            initials={initials}
            alt="รูปคนงาน"
            onChange={(has) => setD((s) => (s ? { ...s, hasPhoto: has } : s))}
          />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <div>
                <h1 className="page-title">{d.prefix}{d.firstName} {d.lastName}</h1>
                <p className="muted mono" style={{ margin: '4px 0 0' }}>{d.workerCode}</p>
              </div>
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
          <div><label className="form-label">คำนำหน้า</label><input className="form-input" value={form.prefix ?? ''} onChange={set('prefix')} /></div>
          <div><label className="form-label">เบอร์โทร</label><input className="form-input" value={form.phone ?? ''} onChange={set('phone')} /></div>
          <div><label className="form-label">ชื่อ</label><input className="form-input" value={form.firstName ?? ''} onChange={set('firstName')} /></div>
          <div><label className="form-label">นามสกุล</label><input className="form-input" value={form.lastName ?? ''} onChange={set('lastName')} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label className="form-label">ตำแหน่ง/หน้าที่</label><input className="form-input" value={form.position ?? ''} onChange={set('position')} placeholder="เช่น นักการภารโรง" /></div>
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
            {d.hasCitizenId && <div style={{ marginTop: 4 }}><RevealButton endpoint={`/api/users/workers/${id}/reveal`} field="citizen_id" label="แสดงเลขเต็ม" /></div>}
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
          endpoint={`/api/users/workers/${id}/status`}
          onClose={() => setShowResign(false)}
          onDone={() => { setShowResign(false); load(); }}
        />
      )}
    </div>
  );
}

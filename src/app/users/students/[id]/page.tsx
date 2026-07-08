'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { RevealButton } from '@/components/RevealButton';
import { IconBack, IconEdit } from '@/components/Icons';
import { formatThaiDate, ageFromThaiDate } from '@/lib/thai';

interface Guardian {
  id: number; guardianType: string; relationship: string | null;
  prefix: string | null; firstName: string | null; lastName: string | null;
  occupation: string | null; workplace: string | null; mobilePhone: string | null;
  familyStatus: string | null; education: string | null;
  citizenIdMasked: string | null; hasCitizenId: boolean; hasIncome: boolean;
  province: string | null; district: string | null;
}
interface Detail {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; nickname: string | null;
  firstNameEn: string | null; lastNameEn: string | null;
  gender: string | null; birthDate: string | null; religion: string | null;
  nationality: string | null; ethnicity: string | null; phone: string | null; email: string | null;
  admissionDate: string | null;
  citizenIdMasked: string | null; hasCitizenId: boolean; hasPassword: boolean;
  enrollments: { id: number; gradeLevel: string | null; classroom: string | null; classNumber: string | null; academicYear: { year: number; isActive: boolean } }[];
  addresses: Record<string, unknown>[];
  guardians: Guardian[];
  previousSchool: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
}

const GUARDIAN_LABEL: Record<string, string> = { father: 'บิดา', mother: 'มารดา', guardian: 'ผู้ปกครอง' };
const ADDR_LABEL: Record<string, string> = { household: 'ที่อยู่ตามทะเบียนบ้าน', birth_place: 'สถานที่เกิด', current: 'ที่อยู่ปัจจุบัน', hometown: 'บ้านเกิด' };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 15 }}>{value || <span className="muted">-</span>}</div>
    </div>
  );
}

function fmtAddress(a: Record<string, unknown>): string {
  const parts = [
    a.houseNo && `บ้านเลขที่ ${a.houseNo}`, a.moo && `หมู่ ${a.moo}`, a.soi && `ซอย ${a.soi}`,
    a.road && `ถ.${a.road}`, a.subDistrict, a.district, a.province, a.postalCode,
  ].filter(Boolean);
  return parts.join(' ');
}

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Detail>>({});
  const [busy, setBusy] = useState(false);

  function load() {
    api<Detail>(`/api/users/students/${id}`).then((x) => { setD(x); setForm(x); }).catch((e) => setError(e.message));
  }
  useEffect(load, [id]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!d) return <div className="skeleton" style={{ height: 200 }} />;

  const activeEnrollment = d.enrollments.find((e) => e.academicYear.isActive) ?? d.enrollments[0];

  async function save() {
    setBusy(true);
    try {
      const payload = {
        prefix: form.prefix, firstName: form.firstName, lastName: form.lastName,
        nickname: form.nickname, gender: form.gender, birthDate: form.birthDate,
        religion: form.religion, nationality: form.nationality, ethnicity: form.ethnicity,
        phone: form.phone, email: form.email,
      };
      await api(`/api/users/students/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('บันทึกข้อมูลเรียบร้อยแล้ว', 'success');
      setEditing(false);
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!confirm('ยืนยันการย้ายนักเรียนไปคลัง (archive)? ข้อมูลจะไม่หาย แต่จะไม่แสดงในรายการ')) return;
    try {
      await api(`/api/users/students/${id}`, { method: 'DELETE' });
      toast('ย้ายไปคลังแล้ว', 'success');
      router.push('/users/students');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const set = (k: keyof Detail) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <Link href="/users/students" className="btn btn-ghost btn-sm"><IconBack width={16} height={16} /> กลับรายชื่อ</Link>
        <div className="row" style={{ gap: 8 }}>
          {!editing && <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}><IconEdit width={16} height={16} /> แก้ไข</button>}
          {editing && <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setForm(d); }}>ยกเลิก</button>}
          {editing && <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>บันทึก</button>}
          <button className="btn btn-danger btn-sm" onClick={archive}>ย้ายออก</button>
        </div>
      </div>

      {/* Identity header */}
      <div className="card">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="row" style={{ gap: 10 }}>
              <h1 className="page-title">{d.prefix}{d.firstName} {d.lastName}</h1>
              {d.nickname && <span className="chip">{d.nickname}</span>}
            </div>
            <p className="muted mono" style={{ margin: '4px 0 0' }}>{d.studentCode}</p>
          </div>
          {activeEnrollment && (
            <div className="badge badge-purple" style={{ fontSize: 13, padding: '6px 12px' }}>
              {activeEnrollment.gradeLevel} / ห้อง {activeEnrollment.classroom} / เลขที่ {activeEnrollment.classNumber}
            </div>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '0.5px solid var(--skdw-border)', margin: '16px 0' }} />

        {!editing ? (
          <div className="grid-4" style={{ gap: 16 }}>
            <Field label="ชื่อ (EN)" value={[d.firstNameEn, d.lastNameEn].filter(Boolean).join(' ')} />
            <Field label="เพศ" value={d.gender} />
            <Field label="วันเกิด" value={d.birthDate ? `${formatThaiDate(d.birthDate)} (${ageFromThaiDate(d.birthDate) ?? '?'} ปี)` : null} />
            <Field label="ศาสนา" value={d.religion} />
            <Field label="สัญชาติ / เชื้อชาติ" value={[d.nationality, d.ethnicity].filter(Boolean).join(' / ')} />
            <Field label="เบอร์โทร" value={d.phone} />
            <Field label="อีเมล" value={d.email} />
            <Field label="วันที่เข้าเรียน" value={formatThaiDate(d.admissionDate)} />
          </div>
        ) : (
          <div className="grid-3" style={{ gap: 12 }}>
            <div><label className="form-label">คำนำหน้า</label><input className="form-input" value={form.prefix ?? ''} onChange={set('prefix')} /></div>
            <div><label className="form-label">ชื่อ</label><input className="form-input" value={form.firstName ?? ''} onChange={set('firstName')} /></div>
            <div><label className="form-label">นามสกุล</label><input className="form-input" value={form.lastName ?? ''} onChange={set('lastName')} /></div>
            <div><label className="form-label">ชื่อเล่น</label><input className="form-input" value={form.nickname ?? ''} onChange={set('nickname')} /></div>
            <div><label className="form-label">เพศ</label><input className="form-input" value={form.gender ?? ''} onChange={set('gender')} /></div>
            <div><label className="form-label">วันเกิด (ว/ด/ปพ.)</label><input className="form-input" value={form.birthDate ?? ''} onChange={set('birthDate')} /></div>
            <div><label className="form-label">ศาสนา</label><input className="form-input" value={form.religion ?? ''} onChange={set('religion')} /></div>
            <div><label className="form-label">เบอร์โทร</label><input className="form-input" value={form.phone ?? ''} onChange={set('phone')} /></div>
            <div><label className="form-label">อีเมล</label><input className="form-input" value={form.email ?? ''} onChange={set('email')} /></div>
          </div>
        )}
      </div>

      {/* Sensitive data */}
      <div className="card">
        <h2 className="section-title">ข้อมูลอ่อนไหว (การดูจะถูกบันทึก)</h2>
        <div className="grid-3" style={{ gap: 16, alignItems: 'center' }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>เลขบัตรประชาชน</div>
            <div className="mono">{d.citizenIdMasked ?? <span className="muted">-</span>}</div>
            {d.hasCitizenId && <div style={{ marginTop: 4 }}><RevealButton endpoint={`/api/users/students/${id}/reveal`} field="citizen_id" label="แสดงเลขเต็ม" /></div>}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>รหัสผ่าน</div>
            {d.hasPassword ? <RevealButton endpoint={`/api/users/students/${id}/reveal`} field="password" label="ดูรหัสผ่าน" /> : <span className="muted">ไม่มี</span>}
          </div>
        </div>
      </div>

      {/* Guardians */}
      <div className="card">
        <h2 className="section-title">ผู้ปกครอง / บิดา / มารดา</h2>
        {d.guardians.length === 0 && <p className="muted">ไม่มีข้อมูล</p>}
        <div className="grid-3">
          {d.guardians.map((g) => (
            <div key={g.id} className="card" style={{ boxShadow: 'none', background: 'var(--skdw-bg)' }}>
              <div className="row-between">
                <b>{GUARDIAN_LABEL[g.guardianType] ?? g.guardianType}</b>
                {g.relationship && <span className="badge badge-muted">{g.relationship}</span>}
              </div>
              <div style={{ marginTop: 6 }}>{g.prefix}{g.firstName} {g.lastName}</div>
              <div className="muted" style={{ fontSize: 13 }}>{[g.occupation, g.workplace].filter(Boolean).join(' · ')}</div>
              {g.mobilePhone && <div className="mono" style={{ fontSize: 13 }}>{g.mobilePhone}</div>}
              <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                {g.hasCitizenId && (
                  <div className="row" style={{ gap: 6 }}>
                    <span className="mono muted" style={{ fontSize: 12 }}>{g.citizenIdMasked}</span>
                    <RevealButton endpoint={`/api/users/students/${id}/reveal`} field="citizen_id" guardianId={g.id} label="เลขบัตร" />
                  </div>
                )}
                {g.hasIncome && <RevealButton endpoint={`/api/users/students/${id}/reveal`} field="income" guardianId={g.id} label="ดูรายได้" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Addresses */}
      <div className="card">
        <h2 className="section-title">ที่อยู่</h2>
        <div className="grid-2">
          {d.addresses.map((a, i) => (
            <div key={i}>
              <div className="badge badge-purple" style={{ marginBottom: 4 }}>{ADDR_LABEL[a.addressType as string] ?? String(a.addressType)}</div>
              <div style={{ fontSize: 14 }}>
                {a.addressType === 'birth_place' && a.hospitalName ? `${a.hospitalName} ` : ''}
                {fmtAddress(a) || <span className="muted">-</span>}
              </div>
            </div>
          ))}
          {d.addresses.length === 0 && <p className="muted">ไม่มีข้อมูล</p>}
        </div>
      </div>

      {/* Health + Previous school */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 className="section-title">สุขภาพ</h2>
          {d.health ? (
            <div className="grid-2" style={{ gap: 12 }}>
              <Field label="น้ำหนัก/ส่วนสูง" value={[d.health.weight && `${d.health.weight} กก`, d.health.height && `${d.health.height} ซม.`].filter(Boolean).join(' / ')} />
              <Field label="กรุ๊ปเลือด" value={d.health.bloodType as string} />
              <Field label="แพ้อาหาร" value={d.health.foodAllergy as string} />
              <Field label="แพ้ยา" value={d.health.drugAllergy as string} />
              <Field label="โรคประจำตัว" value={d.health.chronicDisease as string} />
              <Field label="โรคร้ายแรง" value={d.health.seriousDisease as string} />
            </div>
          ) : <p className="muted">ไม่มีข้อมูล</p>}
        </div>
        <div className="card">
          <h2 className="section-title">สถานศึกษาเดิม</h2>
          {d.previousSchool ? (
            <div className="stack" style={{ gap: 12 }}>
              <Field label="โรงเรียนเดิม" value={d.previousSchool.schoolName as string} />
              <div className="grid-2" style={{ gap: 12 }}>
                <Field label="วุฒิ" value={d.previousSchool.qualification as string} />
                <Field label="GPA" value={d.previousSchool.gpa as string} />
              </div>
              <Field label="เหตุที่ย้าย" value={d.previousSchool.transferReason as string} />
            </div>
          ) : <p className="muted">ไม่มีข้อมูล</p>}
        </div>
      </div>

      {/* Enrollment history */}
      <div className="card">
        <h2 className="section-title">ประวัติการลงทะเบียน</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>ปีการศึกษา</th><th>ชั้น</th><th>ห้อง</th><th>เลขที่</th><th></th></tr></thead>
            <tbody>
              {d.enrollments.slice().sort((a, b) => b.academicYear.year - a.academicYear.year).map((e) => (
                <tr key={e.id}>
                  <td>{e.academicYear.year}</td>
                  <td>{e.gradeLevel}</td>
                  <td>{e.classroom}</td>
                  <td className="mono">{e.classNumber}</td>
                  <td>{e.academicYear.isActive && <span className="badge badge-success">ปัจจุบัน</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

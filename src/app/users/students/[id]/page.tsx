'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { RevealButton } from '@/components/RevealButton';
import { IconBack, IconEdit } from '@/components/Icons';
import { formatThaiDate, ageFromThaiDate } from '@/lib/thai';
import { StatusDialog } from '@/components/StatusDialog';

type Dict = Record<string, string | null | undefined>;

interface Guardian {
  id: number; guardianType: string;
  citizenIdMasked?: string | null; hasCitizenId?: boolean; hasIncome?: boolean;
  [k: string]: unknown;
}
interface Detail {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; nickname: string | null;
  firstNameEn: string | null; lastNameEn: string | null; nicknameEn: string | null;
  gender: string | null; birthDate: string | null; religion: string | null;
  nationality: string | null; ethnicity: string | null; phone: string | null; email: string | null;
  admissionDate: string | null;
  siblingsTotal: number | null; siblingOrder: number | null; hasSiblingInSchool: string | null;
  status: 'studying' | 'withdrawn' | 'graduated';
  exitType: string | null; exitReason: string | null; exitDate: string | null;
  citizenIdMasked: string | null; hasCitizenId: boolean; hasPassword: boolean; hasPhoto: boolean;
  enrollments: { id: number; academicYearId: number; gradeLevel: string | null; classroom: string | null; classNumber: string | null; academicYear: { id: number; year: number; isActive: boolean } }[];
  addresses: (Dict & { addressType: string })[];
  guardians: Guardian[];
  previousSchool: Dict | null;
  health: Dict | null;
}

const GUARDIAN_TYPES = ['father', 'mother', 'guardian'] as const;
const GUARDIAN_LABEL: Record<string, string> = { father: 'บิดา', mother: 'มารดา', guardian: 'ผู้ปกครอง' };
const ADDRESS_TYPES = ['household', 'current', 'birth_place', 'hometown'] as const;
const ADDR_LABEL: Record<string, string> = { household: 'ที่อยู่ตามทะเบียนบ้าน', birth_place: 'สถานที่เกิด', current: 'ที่อยู่ปัจจุบัน', hometown: 'บ้านเกิด' };

const ADDR_FIELDS: { k: string; label: string }[] = [
  { k: 'houseNo', label: 'บ้านเลขที่' }, { k: 'moo', label: 'หมู่' }, { k: 'soi', label: 'ซอย' },
  { k: 'road', label: 'ถนน' }, { k: 'subDistrict', label: 'ตำบล/แขวง' }, { k: 'district', label: 'อำเภอ/เขต' },
  { k: 'province', label: 'จังหวัด' }, { k: 'postalCode', label: 'รหัสไปรษณีย์' }, { k: 'phone', label: 'โทรศัพท์' },
  { k: 'houseRegCode', label: 'รหัสประจำบ้าน' },
];
const ADDR_EXTRA: Record<string, { k: string; label: string }[]> = {
  birth_place: [{ k: 'hospitalName', label: 'สถานที่เกิด / โรงพยาบาล' }],
  current: [
    { k: 'livingWith', label: 'อาศัยอยู่กับ' }, { k: 'livingWithLastname', label: 'นามสกุลผู้อาศัย' },
    { k: 'houseType', label: 'ประเภทที่พัก' }, { k: 'emergencyPhone', label: 'โทรฉุกเฉิน' },
    { k: 'emergencyEmail', label: 'อีเมลฉุกเฉิน' }, { k: 'nearbyFriendName', label: 'เพื่อนบ้านใกล้เคียง' },
    { k: 'nearbyFriendLastname', label: 'นามสกุลเพื่อนบ้าน' }, { k: 'nearbyFriendPhone', label: 'โทรเพื่อนบ้าน' },
  ],
};

const GUARDIAN_FIELDS: { k: string; label: string }[] = [
  { k: 'prefix', label: 'คำนำหน้า' }, { k: 'firstName', label: 'ชื่อ' }, { k: 'lastName', label: 'นามสกุล' },
  { k: 'relationship', label: 'ความสัมพันธ์' }, { k: 'occupation', label: 'อาชีพ' }, { k: 'workplace', label: 'สถานที่ทำงาน' },
  { k: 'education', label: 'การศึกษา' }, { k: 'familyStatus', label: 'สถานภาพครอบครัว' },
  { k: 'mobilePhone', label: 'มือถือ' }, { k: 'homePhone', label: 'โทรบ้าน' }, { k: 'workPhone', label: 'โทรที่ทำงาน' },
  { k: 'houseNo', label: 'บ้านเลขที่' }, { k: 'moo', label: 'หมู่' }, { k: 'subDistrict', label: 'ตำบล/แขวง' },
  { k: 'district', label: 'อำเภอ/เขต' }, { k: 'province', label: 'จังหวัด' }, { k: 'postalCode', label: 'รหัสไปรษณีย์' },
];
const HEALTH_FIELDS: { k: string; label: string }[] = [
  { k: 'weight', label: 'น้ำหนัก (กก.)' }, { k: 'height', label: 'ส่วนสูง (ซม.)' }, { k: 'bloodType', label: 'กรุ๊ปเลือด' },
  { k: 'foodAllergy', label: 'แพ้อาหาร' }, { k: 'drugAllergy', label: 'แพ้ยา' }, { k: 'otherAllergy', label: 'แพ้อื่น ๆ' },
  { k: 'chronicDisease', label: 'โรคประจำตัว' }, { k: 'seriousDisease', label: 'โรคร้ายแรง' },
];
const PREV_FIELDS: { k: string; label: string }[] = [
  { k: 'schoolName', label: 'โรงเรียนเดิม' }, { k: 'qualification', label: 'วุฒิ' }, { k: 'gpa', label: 'GPA' },
  { k: 'subDistrict', label: 'ตำบล/แขวง' }, { k: 'district', label: 'อำเภอ/เขต' }, { k: 'province', label: 'จังหวัด' },
  { k: 'transferReason', label: 'เหตุที่ย้าย' },
];

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 15 }}>{value === 0 || value ? value : <span className="muted">-</span>}</div>
    </div>
  );
}

function TInput({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const hasAny = (d: Dict) => Object.values(d).some((v) => v !== null && v !== undefined && String(v).trim() !== '');

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoVer, setPhotoVer] = useState(0);
  const [statusMode, setStatusMode] = useState<null | 'withdrawn'>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // Editable form state (nested). Kept as string-only dicts so the PATCH payload
  // stays clean (no id/studentId numbers leaking into the child collections).
  const [core, setCore] = useState<Dict>({});
  const [enroll, setEnroll] = useState<Dict>({});
  const [enrollId, setEnrollId] = useState<number | undefined>(undefined);
  const [health, setHealth] = useState<Dict>({});
  const [prev, setPrev] = useState<Dict>({});
  const [addrs, setAddrs] = useState<Record<string, Dict>>({});
  const [guards, setGuards] = useState<Record<string, Dict>>({});
  const [sensitive, setSensitive] = useState<{ citizenId: string; password: string }>({ citizenId: '', password: '' });

  function load() {
    api<Detail>(`/api/users/students/${id}`).then((x) => setD(x)).catch((e) => setError(e.message));
  }
  useEffect(load, [id]);

  function beginEdit() {
    if (!d) return;
    setCore({
      prefix: d.prefix, firstName: d.firstName, lastName: d.lastName, nickname: d.nickname,
      firstNameEn: d.firstNameEn, lastNameEn: d.lastNameEn, nicknameEn: d.nicknameEn,
      gender: d.gender, birthDate: d.birthDate, religion: d.religion, nationality: d.nationality,
      ethnicity: d.ethnicity, phone: d.phone, email: d.email, admissionDate: d.admissionDate,
    });
    const active = d.enrollments.find((e) => e.academicYear.isActive) ?? d.enrollments[0];
    setEnrollId(active?.id);
    setEnroll(active ? { gradeLevel: active.gradeLevel, classroom: active.classroom, classNumber: active.classNumber } : {});
    // Copy only known string fields (source rows also carry numeric id/studentId).
    const pick = (src: Dict | null | undefined, fields: { k: string }[]): Dict => {
      const out: Dict = {};
      for (const f of fields) out[f.k] = (src?.[f.k] as string | null | undefined) ?? null;
      return out;
    };
    setHealth(pick(d.health, HEALTH_FIELDS));
    setPrev(pick(d.previousSchool, PREV_FIELDS));
    const am: Record<string, Dict> = {};
    for (const a of d.addresses) am[a.addressType] = pick(a, [...ADDR_FIELDS, ...(ADDR_EXTRA[a.addressType] ?? [])]);
    setAddrs(am);
    const gm: Record<string, Dict> = {};
    for (const g of d.guardians) gm[g.guardianType] = pick(g as unknown as Dict, GUARDIAN_FIELDS);
    setGuards(gm);
    setSensitive({ citizenId: '', password: '' });
    setEditing(true);
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!d) return <div className="skeleton" style={{ height: 200 }} />;

  const activeEnrollment = d.enrollments.find((e) => e.academicYear.isActive) ?? d.enrollments[0];
  const addrByType = Object.fromEntries(d.addresses.map((a) => [a.addressType, a]));
  const guardByType = Object.fromEntries(d.guardians.map((g) => [g.guardianType, g]));
  const photoUrl = d.hasPhoto ? `/api/users/students/${id}/photo?v=${photoVer}` : null;
  const initials = (d.firstName?.[0] ?? '') + (d.lastName?.[0] ?? '');

  async function save() {
    setBusy(true);
    try {
      const payload = {
        ...core,
        citizenId: sensitive.citizenId || undefined,
        password: sensitive.password || undefined,
        enrollment: { id: enrollId, gradeLevel: enroll.gradeLevel, classroom: enroll.classroom, classNumber: enroll.classNumber },
        health,
        previousSchool: prev,
        addresses: ADDRESS_TYPES
          .filter((t) => addrs[t] && hasAny(addrs[t]))
          .map((t) => ({ ...addrs[t], addressType: t })),
        guardians: GUARDIAN_TYPES
          .filter((t) => guards[t] && hasAny(guards[t]))
          .map((t) => ({ ...guards[t], guardianType: t })),
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

  async function uploadPhoto(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/api/users/students/${id}/photo`, { method: 'POST', body: fd });
      toast('อัปโหลดรูปแล้ว', 'success');
      setD((s) => (s ? { ...s, hasPhoto: true } : s));
      setPhotoVer((v) => v + 1);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    if (!(await confirm({ title: 'ลบรูป', message: 'ลบรูปนักเรียนคนนี้?', confirmText: 'ลบรูป', danger: true }))) return;
    try {
      await api(`/api/users/students/${id}/photo`, { method: 'DELETE' });
      toast('ลบรูปแล้ว', 'success');
      setD((s) => (s ? { ...s, hasPhoto: false } : s));
      setPhotoVer((v) => v + 1);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function archive() {
    if (!(await confirm({
      title: 'ย้ายไปคลัง',
      message: 'ยืนยันการย้ายนักเรียนไปคลัง (archive)? ข้อมูลจะไม่หาย แต่จะไม่แสดงในรายการ',
      confirmText: 'ย้ายไปคลัง',
      danger: true,
    }))) return;
    try {
      await api(`/api/users/students/${id}`, { method: 'DELETE' });
      toast('ย้ายไปคลังแล้ว', 'success');
      router.push('/users/students');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function reinstate() {
    if (!(await confirm({
      title: 'คืนสถานะ',
      message: 'คืนสถานะเป็น “กำลังศึกษา”? ข้อมูลการออก (วันที่/เหตุผล) จะถูกล้าง',
      confirmText: 'คืนสถานะ',
    }))) return;
    try {
      await api(`/api/users/students/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'studying' }) });
      toast('คืนสถานะแล้ว', 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const setC = (k: string) => (v: string) => setCore((s) => ({ ...s, [k]: v }));
  const setE = (k: string) => (v: string) => setEnroll((s) => ({ ...s, [k]: v }));
  const setH = (k: string) => (v: string) => setHealth((s) => ({ ...s, [k]: v }));
  const setP = (k: string) => (v: string) => setPrev((s) => ({ ...s, [k]: v }));
  const setA = (t: string, k: string) => (v: string) => setAddrs((s) => ({ ...s, [t]: { ...s[t], [k]: v } }));
  const setG = (t: string, k: string) => (v: string) => setGuards((s) => ({ ...s, [t]: { ...s[t], [k]: v } }));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <Link href="/users/students" className="btn btn-ghost btn-sm"><IconBack width={16} height={16} /> กลับรายชื่อ</Link>
        <div className="row" style={{ gap: 8 }}>
          {!editing && <button className="btn btn-secondary btn-sm" onClick={beginEdit}><IconEdit width={16} height={16} /> แก้ไข</button>}
          {editing && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>ยกเลิก</button>}
          {editing && <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>}
          {!editing && <button className="btn btn-danger btn-sm" onClick={archive}>ย้ายออก</button>}
        </div>
      </div>

      {/* Identity header */}
      <div className="card">
        <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Photo */}
          <div className="stack" style={{ gap: 8, alignItems: 'center', width: 116 }}>
            <div style={{
              width: 116, height: 140, borderRadius: 12, overflow: 'hidden', background: 'var(--skdw-purple-pale)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--skdw-border)',
            }}>
              {photoUrl
                ? <img src={photoUrl} alt="รูปนักเรียน" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 34, fontWeight: 700, color: 'var(--skdw-purple)' }}>{initials || '—'}</span>}
            </div>
            <input
              ref={photoInput} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }}
            />
            <div className="row" style={{ gap: 4 }}>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => photoInput.current?.click()} disabled={busy}>
                {d.hasPhoto ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
              </button>
              {d.hasPhoto && <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: '4px 8px', color: 'var(--color-error)' }} onClick={removePhoto} disabled={busy}>ลบ</button>}
            </div>
          </div>

          {/* Name + code + badge */}
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="row" style={{ gap: 10 }}>
                  <h1 className="page-title">{d.prefix}{d.firstName} {d.lastName}</h1>
                  {d.nickname && <span className="chip">{d.nickname}</span>}
                </div>
                <p className="muted mono" style={{ margin: '4px 0 0' }}>{d.studentCode}</p>
              </div>
              {activeEnrollment && !editing && (
                <div className="badge badge-purple" style={{ fontSize: 13, padding: '6px 12px' }}>
                  {activeEnrollment.gradeLevel ?? '-'} / ห้อง {activeEnrollment.classroom ?? '-'} / เลขที่ {activeEnrollment.classNumber ?? '-'}
                </div>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '0.5px solid var(--skdw-border)', margin: '16px 0' }} />

            {!editing ? (
              <div className="grid-4" style={{ gap: 16 }}>
                <Field label="ชื่อ (EN)" value={[d.firstNameEn, d.lastNameEn].filter(Boolean).join(' ')} />
                <Field label="ชื่อเล่น (EN)" value={d.nicknameEn} />
                <Field label="เพศ" value={d.gender} />
                <Field label="วันเกิด" value={d.birthDate ? `${formatThaiDate(d.birthDate)} (${ageFromThaiDate(d.birthDate) ?? '?'} ปี)` : null} />
                <Field label="ศาสนา" value={d.religion} />
                <Field label="สัญชาติ" value={d.nationality} />
                <Field label="เชื้อชาติ" value={d.ethnicity} />
                <Field label="เบอร์โทร" value={d.phone} />
                <Field label="อีเมล" value={d.email} />
                <Field label="วันที่เข้าเรียน" value={formatThaiDate(d.admissionDate)} />
                <Field label="จำนวนพี่น้อง" value={d.siblingsTotal} />
                <Field label="เป็นบุตรคนที่" value={d.siblingOrder} />
                <Field label="มีพี่น้องในโรงเรียน" value={d.hasSiblingInSchool} />
              </div>
            ) : (
              <div className="grid-3" style={{ gap: 12 }}>
                <TInput label="คำนำหน้า" value={core.prefix} onChange={setC('prefix')} />
                <TInput label="ชื่อ" value={core.firstName} onChange={setC('firstName')} />
                <TInput label="นามสกุล" value={core.lastName} onChange={setC('lastName')} />
                <TInput label="ชื่อเล่น" value={core.nickname} onChange={setC('nickname')} />
                <TInput label="ชื่อ (EN)" value={core.firstNameEn} onChange={setC('firstNameEn')} />
                <TInput label="นามสกุล (EN)" value={core.lastNameEn} onChange={setC('lastNameEn')} />
                <TInput label="ชื่อเล่น (EN)" value={core.nicknameEn} onChange={setC('nicknameEn')} />
                <TInput label="เพศ" value={core.gender} onChange={setC('gender')} />
                <TInput label="วันเกิด (ว/ด/ปพ.)" value={core.birthDate} onChange={setC('birthDate')} />
                <TInput label="ศาสนา" value={core.religion} onChange={setC('religion')} />
                <TInput label="สัญชาติ" value={core.nationality} onChange={setC('nationality')} />
                <TInput label="เชื้อชาติ" value={core.ethnicity} onChange={setC('ethnicity')} />
                <TInput label="เบอร์โทร" value={core.phone} onChange={setC('phone')} />
                <TInput label="อีเมล" value={core.email} onChange={setC('email')} />
                <TInput label="วันที่เข้าเรียน" value={core.admissionDate} onChange={setC('admissionDate')} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lifecycle status */}
      {!editing && (
        <div className="card">
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="section-title" style={{ marginBottom: 8 }}>สถานะการศึกษา</h2>
              {d.status === 'studying' ? (
                <span className="badge badge-success">กำลังศึกษา</span>
              ) : (
                <div className="stack" style={{ gap: 4 }}>
                  <span className="badge" style={{ background: 'var(--skdw-bg)', color: 'var(--skdw-dark)' }}>
                    {d.status === 'graduated' ? 'จบการศึกษา' : 'จำหน่าย/ลาออก'}
                    {d.exitType ? ` — ${d.exitType}` : ''}
                  </span>
                  <div className="muted" style={{ fontSize: 13 }}>
                    วันที่ออก: {formatThaiDate(d.exitDate) || '-'} {d.exitReason ? `• ${d.exitReason}` : ''}
                  </div>
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {d.status === 'studying' ? (
                <button className="btn btn-danger btn-sm" onClick={() => setStatusMode('withdrawn')}>จำหน่าย/ลาออก</button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={reinstate}>คืนสถานะกำลังศึกษา</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Current enrollment (edit) */}
      {editing && (
        <div className="card">
          <h2 className="section-title">ชั้น / ห้อง (ปีปัจจุบัน)</h2>
          <div className="grid-3" style={{ gap: 12 }}>
            <TInput label="ชั้น" value={enroll.gradeLevel} onChange={setE('gradeLevel')} />
            <TInput label="ห้อง" value={enroll.classroom} onChange={setE('classroom')} />
            <TInput label="เลขที่" value={enroll.classNumber} onChange={setE('classNumber')} />
          </div>
        </div>
      )}

      {/* Sensitive data */}
      <div className="card">
        <h2 className="section-title">ข้อมูลอ่อนไหว (การดูจะถูกบันทึก)</h2>
        {!editing ? (
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
        ) : (
          <div className="grid-2" style={{ gap: 12 }}>
            <TInput label="เลขบัตรประชาชน (เว้นว่าง = ไม่เปลี่ยน)" value={sensitive.citizenId} onChange={(v) => setSensitive((s) => ({ ...s, citizenId: v }))} />
            <TInput label="รหัสผ่าน (เว้นว่าง = ไม่เปลี่ยน)" value={sensitive.password} onChange={(v) => setSensitive((s) => ({ ...s, password: v }))} />
          </div>
        )}
      </div>

      {/* Guardians */}
      <div className="card">
        <h2 className="section-title">ผู้ปกครอง / บิดา / มารดา</h2>
        <div className="grid-3">
          {GUARDIAN_TYPES.map((t) => {
            const g = guardByType[t] as Guardian | undefined;
            return (
              <div key={t} className="card" style={{ boxShadow: 'none', background: 'var(--skdw-bg)' }}>
                <b>{GUARDIAN_LABEL[t]}</b>
                {!editing ? (
                  <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                    {GUARDIAN_FIELDS.map((f) => <Field key={f.k} label={f.label} value={g?.[f.k] as string} />)}
                    <Field label="เลขบัตรประชาชน" value={g?.hasCitizenId ? (
                      <span className="row" style={{ gap: 6 }}>
                        <span className="mono">{g.citizenIdMasked}</span>
                        <RevealButton endpoint={`/api/users/students/${id}/reveal`} field="citizen_id" guardianId={g.id} label="เลขบัตร" />
                      </span>
                    ) : null} />
                    <Field label="รายได้" value={g?.hasIncome ? (
                      <RevealButton endpoint={`/api/users/students/${id}/reveal`} field="income" guardianId={g.id} label="ดูรายได้" />
                    ) : null} />
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                    {GUARDIAN_FIELDS.map((f) => <TInput key={f.k} label={f.label} value={guards[t]?.[f.k]} onChange={setG(t, f.k)} />)}
                    <TInput label="เลขบัตร ปชช. (เว้นว่าง=ไม่เปลี่ยน)" value={guards[t]?.citizenId} onChange={setG(t, 'citizenId')} />
                    <TInput label="รายได้/เดือน (เว้นว่าง=ไม่เปลี่ยน)" value={guards[t]?.incomeMonthly} onChange={setG(t, 'incomeMonthly')} />
                    <TInput label="รายได้/ปี (เว้นว่าง=ไม่เปลี่ยน)" value={guards[t]?.incomeYearly} onChange={setG(t, 'incomeYearly')} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Addresses */}
      <div className="card">
        <h2 className="section-title">ที่อยู่</h2>
        <div className="grid-2">
          {ADDRESS_TYPES.map((t) => {
            const a = addrByType[t] as Dict | undefined;
            const fields = [...ADDR_FIELDS, ...(ADDR_EXTRA[t] ?? [])];
            return (
              <div key={t}>
                <div className="badge badge-purple" style={{ marginBottom: 6 }}>{ADDR_LABEL[t]}</div>
                {!editing ? (
                  <div className="grid-2" style={{ gap: 8 }}>
                    {fields.map((f) => <Field key={f.k} label={f.label} value={a?.[f.k] as string} />)}
                  </div>
                ) : (
                  <div className="grid-2" style={{ gap: 8 }}>
                    {fields.map((f) => <TInput key={f.k} label={f.label} value={addrs[t]?.[f.k]} onChange={setA(t, f.k)} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Health + Previous school */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 className="section-title">สุขภาพ</h2>
          {!editing ? (
            <div className="grid-2" style={{ gap: 12 }}>
              {HEALTH_FIELDS.map((f) => <Field key={f.k} label={f.label} value={d.health?.[f.k] as string} />)}
            </div>
          ) : (
            <div className="grid-2" style={{ gap: 12 }}>
              {HEALTH_FIELDS.map((f) => <TInput key={f.k} label={f.label} value={health[f.k]} onChange={setH(f.k)} />)}
            </div>
          )}
        </div>
        <div className="card">
          <h2 className="section-title">สถานศึกษาเดิม</h2>
          {!editing ? (
            <div className="grid-2" style={{ gap: 12 }}>
              {PREV_FIELDS.map((f) => <Field key={f.k} label={f.label} value={d.previousSchool?.[f.k] as string} />)}
            </div>
          ) : (
            <div className="grid-2" style={{ gap: 12 }}>
              {PREV_FIELDS.map((f) => <TInput key={f.k} label={f.label} value={prev[f.k]} onChange={setP(f.k)} />)}
            </div>
          )}
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
                  <td>{e.gradeLevel ?? '-'}</td>
                  <td>{e.classroom ?? '-'}</td>
                  <td className="mono">{e.classNumber ?? '-'}</td>
                  <td>{e.academicYear.isActive && <span className="badge badge-success">ปัจจุบัน</span>}</td>
                </tr>
              ))}
              {d.enrollments.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 16 }}>ยังไม่มีข้อมูล</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {statusMode && (
        <StatusDialog
          studentId={d.id}
          mode={statusMode}
          activeGrade={activeEnrollment?.gradeLevel ?? null}
          activeYearId={activeEnrollment?.academicYearId ?? null}
          onClose={() => setStatusMode(null)}
          onDone={() => { setStatusMode(null); load(); }}
        />
      )}
    </div>
  );
}

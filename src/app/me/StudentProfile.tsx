'use client';

import { useState } from 'react';
import { api } from '@/lib/client';
import { useNotice } from '@/components/Notice';
import { ClosedNotice, Field, Locked, SaveBar, Section } from './parts';
import { PasswordCard } from './PasswordCard';

/**
 * A student's own record.
 *
 * A much smaller door than the teacher's, and for a reason worth stating on the
 * page itself: a student record is a school document assembled from papers
 * handed in at admission. Three blocks are the exception, and they are exactly
 * the three the office cannot keep current on its own — ติดต่อ, สุขภาพ, and
 * ที่อยู่ปัจจุบัน. See STUDENT_SELF_EDITABLE in lib/services/student-self.ts.
 */

interface Health {
  weight?: string | null;
  height?: string | null;
  bloodType?: string | null;
  foodAllergy?: string | null;
  drugAllergy?: string | null;
  otherAllergy?: string | null;
  chronicDisease?: string | null;
  seriousDisease?: string | null;
}

interface CurrentAddress {
  houseNo?: string | null;
  moo?: string | null;
  soi?: string | null;
  road?: string | null;
  subDistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  livingWith?: string | null;
  livingWithLastname?: string | null;
  houseType?: string | null;
  emergencyEmail?: string | null;
  emergencyPhone?: string | null;
  nearbyFriendName?: string | null;
  nearbyFriendLastname?: string | null;
  nearbyFriendPhone?: string | null;
}

export interface StudentMe {
  audience: 'student';
  canEdit: boolean;
  closedReason: string | null;
  id: number;
  studentCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  nickname: string | null;
  nicknameEn: string | null;
  firstNameEn: string | null;
  lastNameEn: string | null;
  gender: string | null;
  birthDate: string | null;
  religion: string | null;
  nationality: string | null;
  ethnicity: string | null;
  phone: string | null;
  email: string | null;
  citizenIdMasked: string | null;
  hasPassword: boolean;
  hasPhoto: boolean;
  status: 'studying' | 'withdrawn' | 'graduated';
  enrollment: {
    gradeLevel: string | null;
    classroom: string | null;
    classNumber: string | null;
    year: number | null;
  } | null;
  health: Health | null;
  currentAddress: CurrentAddress | null;
}

const STATUS_LABEL: Record<StudentMe['status'], string> = {
  studying: 'กำลังศึกษา',
  withdrawn: 'ลาออก/จำหน่าย',
  graduated: 'จบการศึกษา',
};

export function StudentProfile({ me, reload }: { me: StudentMe; reload: () => void }) {
  const notice = useNotice();
  const [contact, setContact] = useState({
    phone: me.phone,
    nickname: me.nickname,
    nicknameEn: me.nicknameEn,
  });
  const [health, setHealth] = useState<Health>(me.health ?? {});
  const [address, setAddress] = useState<CurrentAddress>(me.currentAddress ?? {});
  const [busy, setBusy] = useState(false);

  const ro = !me.canEdit;
  const setC = (k: keyof typeof contact) => (v: string) => setContact((s) => ({ ...s, [k]: v }));
  const setH = (k: keyof Health) => (v: string) => setHealth((s) => ({ ...s, [k]: v }));
  const setA = (k: keyof CurrentAddress) => (v: string) => setAddress((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      // Only the three blocks the server accepts. The health and address rows
      // are sent whole — the API upserts them, creating the row on first save.
      await api('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          ...contact,
          health: pick(health, HEALTH_KEYS),
          currentAddress: pick(address, ADDRESS_KEYS),
        }),
      });
      reload();
      notice({ message: 'ข้อมูลติดต่อ สุขภาพ และที่อยู่ปัจจุบันของคุณถูกบันทึกแล้ว' });
    } catch (e) {
      notice({ kind: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const initials = `${me.firstName?.[0] ?? ''}${me.lastName?.[0] ?? ''}`.trim();
  const en = me.enrollment;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div
            style={{
              width: 116, aspectRatio: '3 / 4', borderRadius: 'var(--radius-md)', overflow: 'hidden',
              background: 'var(--skdw-bg)', border: '0.5px solid var(--skdw-border)',
              display: 'grid', placeItems: 'center', color: 'var(--skdw-muted)',
              fontSize: 32, fontWeight: 700, flexShrink: 0,
            }}
          >
            {me.hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/users/me/photo`}
                alt="รูปของฉัน"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span aria-hidden>{initials || '?'}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 className="page-title">
              {me.prefix}{me.firstName} {me.lastName}
              {me.nickname ? <span className="muted" style={{ fontSize: 16 }}> ({me.nickname})</span> : null}
            </h1>
            <p className="muted mono" style={{ margin: '4px 0 0' }}>{me.studentCode}</p>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span className={`badge ${me.status === 'studying' ? 'badge-success' : 'badge-muted'}`}>
                {STATUS_LABEL[me.status]}
              </span>
              {en && (
                <span className="chip">
                  {en.gradeLevel}/{en.classroom} เลขที่ {en.classNumber ?? '-'}
                  {en.year ? ` · ปี ${en.year}` : ''}
                </span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
              รูปติดบัตรและข้อมูลทะเบียนเป็นหน้าที่ของทางโรงเรียน หากไม่ถูกต้องให้แจ้งครูประจำชั้น
            </p>
          </div>
        </div>
      </div>

      {ro && me.closedReason && <ClosedNotice reason={me.closedReason} />}

      <Section title="ข้อมูลติดต่อ" hint={ro ? undefined : 'ส่วนนี้แก้ไขเองได้'}>
        <Field label="เบอร์โทรของฉัน" value={contact.phone} onChange={setC('phone')} placeholder="เช่น 0812345678" disabled={ro} />
        <Field label="ชื่อเล่น" value={contact.nickname} onChange={setC('nickname')} disabled={ro} />
        <Field label="ชื่อเล่น (อังกฤษ)" value={contact.nicknameEn} onChange={setC('nicknameEn')} disabled={ro} />
      </Section>

      <Section
        title="ข้อมูลสุขภาพ"
        hint="ข้อมูลส่วนนี้ใช้เวลาเกิดเหตุฉุกเฉินที่โรงเรียน กรุณากรอกให้เป็นปัจจุบัน โดยเฉพาะการแพ้ยา/แพ้อาหารและโรคประจำตัว"
      >
        <Field label="น้ำหนัก (กก.)" value={health.weight} onChange={setH('weight')} disabled={ro} />
        <Field label="ส่วนสูง (ซม.)" value={health.height} onChange={setH('height')} disabled={ro} />
        <Field label="กรุ๊ปเลือด" value={health.bloodType} onChange={setH('bloodType')} placeholder="เช่น A, B, O, AB" disabled={ro} />
        <Field label="แพ้อาหาร" value={health.foodAllergy} onChange={setH('foodAllergy')} placeholder="ไม่มี = เว้นว่าง" disabled={ro} />
        <Field label="แพ้ยา" value={health.drugAllergy} onChange={setH('drugAllergy')} disabled={ro} />
        <Field label="แพ้อื่น ๆ" value={health.otherAllergy} onChange={setH('otherAllergy')} disabled={ro} />
        <Field label="โรคประจำตัว" value={health.chronicDisease} onChange={setH('chronicDisease')} disabled={ro} />
        <Field label="โรคร้ายแรง" value={health.seriousDisease} onChange={setH('seriousDisease')} disabled={ro} />
      </Section>

      <Section
        title="ที่อยู่ปัจจุบัน และผู้ติดต่อฉุกเฉิน"
        hint="ที่อยู่ที่พักอาศัยจริงในตอนนี้ — ไม่ใช่ที่อยู่ตามทะเบียนบ้าน (ทะเบียนบ้านแก้ไขที่ฝ่ายธุรการ)"
      >
        <Field label="บ้านเลขที่" value={address.houseNo} onChange={setA('houseNo')} disabled={ro} />
        <Field label="หมู่" value={address.moo} onChange={setA('moo')} disabled={ro} />
        <Field label="ซอย" value={address.soi} onChange={setA('soi')} disabled={ro} />
        <Field label="ถนน" value={address.road} onChange={setA('road')} disabled={ro} />
        <Field label="ตำบล/แขวง" value={address.subDistrict} onChange={setA('subDistrict')} disabled={ro} />
        <Field label="อำเภอ/เขต" value={address.district} onChange={setA('district')} disabled={ro} />
        <Field label="จังหวัด" value={address.province} onChange={setA('province')} disabled={ro} />
        <Field label="รหัสไปรษณีย์" value={address.postalCode} onChange={setA('postalCode')} disabled={ro} />
        <Field label="เบอร์โทรศัพท์บ้าน" value={address.phone} onChange={setA('phone')} disabled={ro} />
        <Field label="ลักษณะบ้าน" value={address.houseType} onChange={setA('houseType')} placeholder="เช่น บ้านตนเอง, บ้านเช่า" disabled={ro} />
        <Field label="ปัจจุบันอาศัยอยู่กับ (ชื่อ)" value={address.livingWith} onChange={setA('livingWith')} disabled={ro} />
        <Field label="นามสกุล" value={address.livingWithLastname} onChange={setA('livingWithLastname')} disabled={ro} />
        <Field label="เบอร์ติดต่อฉุกเฉิน" value={address.emergencyPhone} onChange={setA('emergencyPhone')} hint="เบอร์ที่โรงเรียนจะโทรหาเป็นอันดับแรก" disabled={ro} />
        <Field label="อีเมลติดต่อฉุกเฉิน" value={address.emergencyEmail} onChange={setA('emergencyEmail')} disabled={ro} />
        <Field label="เพื่อนใกล้บ้าน (ชื่อ)" value={address.nearbyFriendName} onChange={setA('nearbyFriendName')} disabled={ro} />
        <Field label="นามสกุล" value={address.nearbyFriendLastname} onChange={setA('nearbyFriendLastname')} disabled={ro} />
        <Field label="เบอร์โทรเพื่อนใกล้บ้าน" value={address.nearbyFriendPhone} onChange={setA('nearbyFriendPhone')} disabled={ro} />
      </Section>

      <Section
        title="ข้อมูลทะเบียน"
        badge={<span className="badge badge-muted">ผู้ดูแลระบบแก้ไขให้เท่านั้น</span>}
        hint="ข้อมูลส่วนนี้มาจากเอกสารตอนสมัครเรียนและใช้ออกเอกสารทางการ (ปพ.) หากไม่ถูกต้องให้แจ้งครูประจำชั้นหรือฝ่ายธุรการ"
      >
        <Locked label="คำนำหน้า" value={me.prefix} />
        <Locked label="อีเมล (ใช้เข้าสู่ระบบ)" value={me.email} />
        <Locked label="ชื่อ" value={me.firstName} />
        <Locked label="นามสกุล" value={me.lastName} />
        <Locked label="ชื่อ (อังกฤษ)" value={me.firstNameEn} />
        <Locked label="นามสกุล (อังกฤษ)" value={me.lastNameEn} />
        <Locked label="วันเดือนปีเกิด" value={me.birthDate} />
        <Locked label="เลขบัตรประชาชน" value={me.citizenIdMasked} />
        <Locked label="เพศ" value={me.gender} />
        <Locked label="ศาสนา" value={me.religion} />
        <Locked label="สัญชาติ" value={me.nationality} />
        <Locked label="เชื้อชาติ" value={me.ethnicity} />
      </Section>

      {!ro && (
        <SaveBar busy={busy} onSave={save} hint="บันทึกข้อมูลติดต่อ สุขภาพ และที่อยู่ปัจจุบันพร้อมกัน" />
      )}

      <PasswordCard hasPassword={me.hasPassword} />
    </div>
  );
}

// The child rows arrive from the database carrying `id`/`studentId` too. The
// API strips unknown keys, but the payload is built clean here so what goes over
// the wire is exactly what the page claims to change.
const HEALTH_KEYS = [
  'weight', 'height', 'bloodType', 'foodAllergy', 'drugAllergy', 'otherAllergy',
  'chronicDisease', 'seriousDisease',
] as const;

const ADDRESS_KEYS = [
  'houseNo', 'moo', 'soi', 'road', 'subDistrict', 'district', 'province', 'postalCode',
  'phone', 'livingWith', 'livingWithLastname', 'houseType', 'emergencyEmail',
  'emergencyPhone', 'nearbyFriendName', 'nearbyFriendLastname', 'nearbyFriendPhone',
] as const;

function pick<T extends object, K extends readonly (keyof T)[]>(src: T, keys: K): Pick<T, K[number]> {
  const out = {} as Pick<T, K[number]>;
  for (const k of keys) out[k] = src[k];
  return out;
}

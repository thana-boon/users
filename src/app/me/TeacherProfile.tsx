'use client';

import { useState } from 'react';
import { api } from '@/lib/client';
import { sameValues, useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { useNotice } from '@/components/Notice';
import { PhoneInput } from '@/components/PhoneInput';
import { PhotoCard } from '@/components/PhotoCard';
import { Combo } from '@/components/Combo';
import { DateField } from '@/components/DateField';
import {
  EmergencyContactFields,
  HouseholdAddressFields,
  MonthYearField,
  type HouseholdAddressForm,
} from '@/components/StaffProfileFields';
import {
  QualificationSections,
  type QualificationLists,
} from '@/components/QualificationSections';
import {
  GENDER_OPTIONS, RELIGION_OPTIONS, NATIONALITY_OPTIONS, ETHNICITY_OPTIONS,
} from '@/lib/options';
import { TeachingClasses } from '@/components/TeachingClasses';
import { CitizenIdField, ClosedNotice, Field, Locked, SaveBar, Section } from './parts';

/**
 * A teacher's own record.
 *
 * Split in two on purpose, and the split is visible: fields the teacher owns are
 * ordinary inputs, the registry fields are greyed with one line saying who to
 * ask. See SELF_EDITABLE in lib/services/teachers.ts for what each lock is for.
 */

export interface TeacherMe {
  audience: 'teacher';
  canEdit: boolean;
  closedReason: string | null;
  /** The teacher window AND the school-wide sensitive switch, both true. */
  canEditSensitive: boolean;
  sensitiveClosedReason: string | null;
  id: number;
  teacherCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  lineId: string | null;
  birthDate: string | null;
  subjectGroup: string | null;
  gradeTaught: string | null;
  role: string;
  gender: string | null;
  religion: string | null;
  nationality: string | null;
  ethnicity: string | null;
  citizenIdMasked: string | null;
  hasPassword: boolean;
  hasPhoto: boolean;
  employmentStatus: 'active' | 'resigned';
  emergencyContactName: string | null;
  emergencyPhone: string | null;
  emergencyRelationship: string | null;
  householdAddress: HouseholdAddressForm | null;
  workStart: string | null;
  educations?: QualificationLists['educations'];
  scoutQualifications?: QualificationLists['scoutQualifications'];
  trainings?: QualificationLists['trainings'];
}

export function TeacherProfile({ me, reload }: { me: TeacherMe; reload: () => void }) {
  const notice = useNotice();
  const [form, setForm] = useState({
    phone: me.phone,
    lineId: me.lineId,
    gender: me.gender,
    religion: me.religion,
    nationality: me.nationality,
    ethnicity: me.ethnicity,
    birthDate: me.birthDate,
    emergencyContactName: me.emergencyContactName,
    emergencyPhone: me.emergencyPhone,
    emergencyRelationship: me.emergencyRelationship,
    workStart: me.workStart,
  });
  const [address, setAddress] = useState<HouseholdAddressForm>(me.householdAddress ?? {});
  const [lists, setLists] = useState<QualificationLists>({
    educations: me.educations ?? [],
    scoutQualifications: me.scoutQualifications ?? [],
    trainings: me.trainings ?? [],
  });
  const [hasPhoto, setHasPhoto] = useState(me.hasPhoto);
  // `undefined` until the teacher unlocks and types — see CitizenIdField. The
  // key stays out of the payload, which is how the server reads "no change".
  const [citizenId, setCitizenId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // What was last saved, to tell an edit from a page someone only looked at.
  // The วุฒิ lists are not in it: each row saves itself and guards its own draft.
  const [saved, setSaved] = useState(() => ({ form, address }));
  const [savedCount, setSavedCount] = useState(0);
  const dirty = !sameValues({ form, address }, saved) || citizenId !== undefined;
  useUnsavedChanges(dirty);

  const ro = !me.canEdit;
  const setV = (k: keyof typeof form) => (v: string) => setForm((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      // Exactly the fields the server allows — nothing else is even assembled,
      // so a stray key cannot ride along and turn the save into a 400.
      await api('/api/users/me', {
        method: 'PATCH',
        // The id key is present only when unlocked: with the school's sensitive
        // switch off, the server answers 403 to its mere presence.
        body: JSON.stringify({
          ...form,
          householdAddress: address,
          ...(citizenId === undefined ? {} : { citizenId }),
        }),
      });
      setSaved({ form, address });
      // Re-mount the id field locked again, so a saved number is not "unsaved".
      setCitizenId(undefined);
      setSavedCount((n) => n + 1);
      reload();
      notice({ message: 'ข้อมูลของคุณถูกบันทึกแล้ว' });
    } catch (e) {
      notice({ kind: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  /** One วุฒิ/อบรม list, saved on its row's own บันทึก. */
  async function saveList(patch: Partial<QualificationLists>) {
    try {
      await api('/api/users/me', { method: 'PATCH', body: JSON.stringify(patch) });
      setLists((s) => ({ ...s, ...patch }));
      notice({ message: 'บันทึกรายการแล้ว' });
    } catch (e) {
      notice({ kind: 'error', message: (e as Error).message });
      throw e;
    }
  }

  const initials = `${me.firstName?.[0] ?? ''}${me.lastName?.[0] ?? ''}`.trim();

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="me-hero">
          {ro ? (
            <ReadOnlyPhoto hasPhoto={hasPhoto} initials={initials} />
          ) : (
            <PhotoCard
              baseEndpoint="/api/users/me/photo"
              hasPhoto={hasPhoto}
              initials={initials}
              alt="รูปของฉัน"
              onChange={setHasPhoto}
            />
          )}
          <div className="me-hero-body">
            <h1 className="page-title">{me.prefix}{me.firstName} {me.lastName}</h1>
            <p className="muted mono" style={{ margin: '4px 0 0' }}>{me.teacherCode}</p>
            <div className="me-hero-meta">
              <span className={`badge ${me.role === 'teacher-admin' ? 'badge-gold' : me.role === 'moderator' ? 'badge-purple' : 'badge-muted'}`}>
                {me.role}
              </span>
              <span className={`badge ${me.employmentStatus === 'resigned' ? 'badge-muted' : 'badge-success'}`}>
                {me.employmentStatus === 'resigned' ? 'ลาออกแล้ว' : 'ทำงานอยู่'}
              </span>
              {me.subjectGroup && <span className="chip">{me.subjectGroup}</span>}
            </div>
          </div>
        </div>
      </div>

      {ro && me.closedReason && <ClosedNotice reason={me.closedReason} canChangePassword={false} />}

      <Section title="ข้อมูลส่วนตัวและการติดต่อ" hint={ro ? undefined : 'ส่วนนี้แก้ไขเองได้'}>
        <PhoneInput label="เบอร์โทร" value={form.phone} onChange={setV('phone')} autoComplete="tel" disabled={ro} />
        <Field label="ไอดีไลน์" value={form.lineId} onChange={setV('lineId')} placeholder="เช่น teacher.somchai" autoComplete="off" disabled={ro} />
        {ro ? (
          <>
            <Locked label="วันเดือนปีเกิด" value={form.birthDate} />
            <Locked label="เพศ" value={form.gender} />
            <Locked label="ศาสนา" value={form.religion} />
            <Locked label="สัญชาติ" value={form.nationality} />
            <Locked label="เชื้อชาติ" value={form.ethnicity} />
          </>
        ) : (
          <>
            <DateField label="วันเดือนปีเกิด" value={form.birthDate} onChange={setV('birthDate')} />
            <Combo label="เพศ" value={form.gender} onChange={setV('gender')} options={GENDER_OPTIONS} />
            <Combo label="ศาสนา" value={form.religion} onChange={setV('religion')} options={RELIGION_OPTIONS} />
            <Combo label="สัญชาติ" value={form.nationality} onChange={setV('nationality')} options={NATIONALITY_OPTIONS} />
            <Combo label="เชื้อชาติ" value={form.ethnicity} onChange={setV('ethnicity')} options={ETHNICITY_OPTIONS} />
          </>
        )}
        <MonthYearField
          label="เดือน / ปีที่เข้าทำงาน (พ.ศ.)"
          value={form.workStart}
          onChange={setV('workStart')}
          disabled={ro}
          hint="เดือนและปีที่เริ่มทำงานที่โรงเรียนนี้ เช่น พฤษภาคม 2560"
        />
      </Section>

      <Section title="ผู้ติดต่อฉุกเฉิน" hint={ro ? undefined : 'คนที่โรงเรียนควรติดต่อเมื่อเกิดเหตุฉุกเฉิน'}>
        <EmergencyContactFields
          name={form.emergencyContactName}
          phone={form.emergencyPhone}
          relationship={form.emergencyRelationship}
          onChange={(k, v) => setForm((s) => ({ ...s, [k]: v }))}
          disabled={ro}
        />
      </Section>

      <Section title="ที่อยู่ตามทะเบียนบ้าน" hint={ro ? undefined : 'กรอกตามสำเนาทะเบียนบ้าน'}>
        <HouseholdAddressFields value={address} onChange={setAddress} disabled={ro} />
      </Section>

      <Section
        title="ข้อมูลทะเบียน"
        badge={
          <span className={`badge ${me.canEditSensitive ? 'badge-warning' : 'badge-muted'}`}>
            {me.canEditSensitive ? 'แก้ได้เฉพาะเลขบัตรประชาชน' : 'ผู้ดูแลระบบแก้ไขให้เท่านั้น'}
          </span>
        }
        hint="ข้อมูลส่วนนี้ใช้ในเอกสารราชการและใช้เข้าสู่ระบบ หากไม่ถูกต้องกรุณาแจ้งฝ่ายธุรการ/ผู้ดูแลระบบเพื่อแก้ไขให้"
      >
        <Locked label="คำนำหน้า" value={me.prefix} />
        <Locked label="อีเมล (ใช้เข้าสู่ระบบ)" value={me.email} />
        <Locked label="ชื่อ" value={me.firstName} />
        <Locked label="นามสกุล" value={me.lastName} />
        <CitizenIdField
          key={savedCount}
          masked={me.citizenIdMasked}
          canEdit={me.canEditSensitive}
          closedReason={me.sensitiveClosedReason}
          onChange={setCitizenId}
        />
        <Locked label="กลุ่มสาระที่สอน" value={me.subjectGroup} />
        <TeachingClasses url="/api/users/me/teaching" stored={me.gradeTaught} style={{ gridColumn: '1 / -1' }} />
      </Section>

      {!ro && (
        <SaveBar
          busy={busy}
          onSave={save}
          dirty={dirty}
          hint="บันทึกข้อมูลส่วนตัว ผู้ติดต่อฉุกเฉิน ที่อยู่ และเลขบัตรประชาชน"
        />
      )}

      {/* The three lists — the same editor an admin gets on the teacher page.
          Below the save bar because they do not need it: each row has its own. */}
      <QualificationSections lists={lists} onChange={saveList} readOnly={ro} />

      {/* No เปลี่ยนรหัสผ่าน card: staff passwords are set by an admin only
          (api/users/me/password refuses teachers). */}
      <div className="alert alert-info" style={{ fontSize: 'var(--text-sm)' }}>
        ต้องการเปลี่ยนรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ
      </div>
    </div>
  );
}

/** The photo without its อัปโหลด/ลบ buttons, for a closed window. */
function ReadOnlyPhoto({ hasPhoto, initials }: { hasPhoto: boolean; initials: string }) {
  return (
    <div className="me-photo">
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/users/me/photo`}
          alt="รูปของฉัน"
          width={116}
          height={155}
        />
      ) : (
        <span aria-hidden>{initials || '?'}</span>
      )}
    </div>
  );
}

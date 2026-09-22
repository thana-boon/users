'use client';

import { useState } from 'react';
import { api } from '@/lib/client';
import { useNotice } from '@/components/Notice';
import { PhotoCard } from '@/components/PhotoCard';
import { Combo } from '@/components/Combo';
import {
  QualificationSections,
  type QualificationLists,
} from '@/components/QualificationSections';
import {
  GENDER_OPTIONS, RELIGION_OPTIONS, NATIONALITY_OPTIONS, ETHNICITY_OPTIONS,
} from '@/lib/options';
import { CitizenIdField, ClosedNotice, Field, Locked, SaveBar, Section } from './parts';
import { PasswordCard } from './PasswordCard';

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
  });
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
          ...lists,
          ...(citizenId === undefined ? {} : { citizenId }),
        }),
      });
      reload();
      notice({ message: 'ข้อมูลติดต่อและวุฒิ/การอบรมของคุณถูกบันทึกแล้ว' });
    } catch (e) {
      notice({ kind: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const initials = `${me.firstName?.[0] ?? ''}${me.lastName?.[0] ?? ''}`.trim();

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 className="page-title">{me.prefix}{me.firstName} {me.lastName}</h1>
            <p className="muted mono" style={{ margin: '4px 0 0' }}>{me.teacherCode}</p>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span className={`badge ${me.role === 'teacher-admin' ? 'badge-gold' : 'badge-muted'}`}>
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

      {ro && me.closedReason && <ClosedNotice reason={me.closedReason} />}

      <Section title="ข้อมูลติดต่อ" hint={ro ? undefined : 'ส่วนนี้แก้ไขเองได้'}>
        <Field label="เบอร์โทร" value={form.phone} onChange={setV('phone')} placeholder="เช่น 0812345678" disabled={ro} />
        <Field label="ไอดีไลน์" value={form.lineId} onChange={setV('lineId')} placeholder="เช่น teacher.somchai" disabled={ro} />
        {ro ? (
          <>
            <Locked label="เพศ" value={form.gender} />
            <Locked label="ศาสนา" value={form.religion} />
            <Locked label="สัญชาติ" value={form.nationality} />
            <Locked label="เชื้อชาติ" value={form.ethnicity} />
          </>
        ) : (
          <>
            <Combo label="เพศ" value={form.gender} onChange={setV('gender')} options={GENDER_OPTIONS} />
            <Combo label="ศาสนา" value={form.religion} onChange={setV('religion')} options={RELIGION_OPTIONS} />
            <Combo label="สัญชาติ" value={form.nationality} onChange={setV('nationality')} options={NATIONALITY_OPTIONS} />
            <Combo label="เชื้อชาติ" value={form.ethnicity} onChange={setV('ethnicity')} options={ETHNICITY_OPTIONS} />
          </>
        )}
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
        <Locked label="วันเดือนปีเกิด" value={me.birthDate} />
        <CitizenIdField
          masked={me.citizenIdMasked}
          canEdit={me.canEditSensitive}
          closedReason={me.sensitiveClosedReason}
          onChange={setCitizenId}
        />
        <Locked label="กลุ่มสาระที่สอน" value={me.subjectGroup} />
        <Locked label="ชั้นที่สอน" value={me.gradeTaught} />
      </Section>

      {/* The three lists — the same editor an admin gets on the teacher page. */}
      <QualificationSections lists={lists} onChange={setLists} readOnly={ro} />

      {!ro && (
        <SaveBar busy={busy} onSave={save} hint="บันทึกข้อมูลติดต่อและวุฒิ/การอบรมทั้งหมดพร้อมกัน" />
      )}

      <PasswordCard hasPassword={me.hasPassword} />
    </div>
  );
}

/** The photo without its อัปโหลด/ลบ buttons, for a closed window. */
function ReadOnlyPhoto({ hasPhoto, initials }: { hasPhoto: boolean; initials: string }) {
  return (
    <div
      style={{
        width: 116, aspectRatio: '3 / 4', borderRadius: 'var(--radius-md)', overflow: 'hidden',
        background: 'var(--skdw-bg)', border: '0.5px solid var(--skdw-border)',
        display: 'grid', placeItems: 'center', color: 'var(--skdw-muted)',
        fontSize: 32, fontWeight: 700, flexShrink: 0,
      }}
    >
      {hasPhoto ? (
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
  );
}

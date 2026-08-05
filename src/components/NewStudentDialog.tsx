'use client';

import { useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';
import { Combo } from './Combo';
import {
  GENDER_OPTIONS, RELIGION_OPTIONS, NATIONALITY_OPTIONS, ETHNICITY_OPTIONS,
  STUDENT_PREFIX_OPTIONS,
} from '@/lib/options';

/** Minimal create form. Full profile (addresses/guardians/health) is populated via import. */
export function NewStudentDialog({
  grades,
  onClose,
  onCreated,
}: {
  grades: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    studentCode: '', prefix: 'เด็กชาย', firstName: '', lastName: '', nickname: '',
    gender: 'ชาย', gradeLevel: grades[0] ?? '', classroom: '', classNumber: '',
    religion: 'พุทธ', nationality: 'ไทย', ethnicity: 'ไทย',
    email: '', password: '', citizenId: '',
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const setV = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    if (!f.studentCode || !f.firstName || !f.lastName) {
      toast('กรุณากรอกรหัส/ชื่อ/นามสกุล', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/api/users/students', jsonBody(f));
      onCreated();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="เพิ่มนักเรียน">
      <div className="modal">
        <div className="card-header">เพิ่มนักเรียน</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div className="grid-2">
            <div>
              <label className="form-label required">รหัสนักเรียน</label>
              <input className="form-input" value={f.studentCode} onChange={set('studentCode')} placeholder="เช่น 07822" />
            </div>
            <Combo label="คำนำหน้า" value={f.prefix} onChange={setV('prefix')} options={STUDENT_PREFIX_OPTIONS} />
          </div>
          <div className="grid-2">
            <div><label className="form-label required">ชื่อ</label><input className="form-input" value={f.firstName} onChange={set('firstName')} /></div>
            <div><label className="form-label required">นามสกุล</label><input className="form-input" value={f.lastName} onChange={set('lastName')} /></div>
          </div>
          <div className="grid-3">
            <div><label className="form-label">ชื่อเล่น</label><input className="form-input" value={f.nickname} onChange={set('nickname')} /></div>
            <Combo label="เพศ" value={f.gender} onChange={setV('gender')} options={GENDER_OPTIONS} />
            <div>
              <label className="form-label">ชั้น</label>
              <select className="form-select" value={f.gradeLevel} onChange={set('gradeLevel')}>
                {grades.length === 0 && <option value="">-</option>}
                {grades.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-3">
            <div><label className="form-label">ห้อง</label><input className="form-input" value={f.classroom} onChange={set('classroom')} /></div>
            <div><label className="form-label">เลขที่</label><input className="form-input" value={f.classNumber} onChange={set('classNumber')} /></div>
            <div><label className="form-label">เลขบัตร ปชช.</label><input className="form-input" value={f.citizenId} onChange={set('citizenId')} /></div>
          </div>
          <div className="grid-3">
            <Combo label="ศาสนา" value={f.religion} onChange={setV('religion')} options={RELIGION_OPTIONS} />
            <Combo label="สัญชาติ" value={f.nationality} onChange={setV('nationality')} options={NATIONALITY_OPTIONS} />
            <Combo label="เชื้อชาติ" value={f.ethnicity} onChange={setV('ethnicity')} options={ETHNICITY_OPTIONS} />
          </div>
          <div className="grid-2">
            <div><label className="form-label">อีเมล</label><input className="form-input" value={f.email} onChange={set('email')} placeholder="07822@sukhon.ac.th" /></div>
            <div><label className="form-label">รหัสผ่าน (เก็บแบบเข้ารหัส)</label><input className="form-input" value={f.password} onChange={set('password')} /></div>
          </div>
        </div>
        <div className="row-between card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}

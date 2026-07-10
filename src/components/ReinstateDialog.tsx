'use client';

import { useEffect, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';

/**
 * คืนสถานะ (reinstate) a withdrawn student. Sets status back to กำลังศึกษา and
 * places them into a room by upserting the enrollment for the current active
 * year. ชั้น/ห้อง default to the room they left; both are editable (with
 * datalist suggestions from the active year's existing rooms).
 */

interface Meta {
  yearId: number;
  grades: string[];
  classrooms: string[];
  years: { id: number; year: number; isActive: boolean }[];
}

export function ReinstateDialog({
  studentId, studentLabel, defaultGrade, defaultClassroom, onClose, onDone,
}: {
  studentId: number;
  studentLabel: string;
  defaultGrade: string | null;
  defaultClassroom: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [grade, setGrade] = useState(defaultGrade ?? '');
  const [classroom, setClassroom] = useState(defaultClassroom ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Meta>('/api/users/meta').then(setMeta).catch((e) => toast((e as Error).message, 'error'));
  }, [toast]);

  const activeYear = meta?.years.find((y) => y.id === meta.yearId);

  async function submit() {
    if (!meta) return;
    setBusy(true);
    try {
      await api(`/api/users/students/${studentId}/status`, jsonBody({
        status: 'studying',
        placement: {
          academicYearId: meta.yearId,
          gradeLevel: grade.trim() || null,
          classroom: classroom.trim() || null,
        },
      }));
      toast('คืนสถานะแล้ว', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="คืนสถานะ">
      <div className="modal">
        <div className="card-header">คืนสถานะกำลังศึกษา</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <p className="muted" style={{ fontSize: 13 }}>
            คืนสถานะ <strong>{studentLabel}</strong> และลงทะเบียนกลับเข้าห้องในปีการศึกษา{' '}
            <strong>{activeYear ? activeYear.year : '…'}</strong> (ปีปัจจุบัน)
          </p>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label className="form-label">ชั้น</label>
              <input
                className="form-input"
                list="reinstate-grades"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="เช่น ม.2"
              />
              <datalist id="reinstate-grades">
                {(meta?.grades ?? []).map((g) => <option key={g} value={g} />)}
              </datalist>
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label className="form-label">ห้อง</label>
              <input
                className="form-input"
                list="reinstate-rooms"
                value={classroom}
                onChange={(e) => setClassroom(e.target.value)}
                placeholder="เช่น 1"
              />
              <datalist id="reinstate-rooms">
                {(meta?.classrooms ?? []).map((r) => <option key={r} value={r} />)}
              </datalist>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            ค่าเริ่มต้นเป็นชั้น/ห้องล่าสุดที่ออก — แก้ไขได้หากต้องการย้ายไปห้องอื่น
          </p>
          <div className="row-between">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !meta}>
              {busy ? 'กำลังบันทึก…' : 'คืนสถานะ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

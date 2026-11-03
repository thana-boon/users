'use client';

import { useEffect, useState } from 'react';
import { withBase } from '@/lib/client';
import { ALL_STUDENT_ZONE_KEYS, STUDENT_EXPORT_ZONES } from '@/lib/student-export-zones';

/**
 * ส่งออกนักเรียน: pick the โซนข้อมูล and whether ลาออก students come along.
 * Every zone ticked = the full 157-column file that re-imports; fewer zones
 * make a lighter sheet the import refuses (it reads columns by position).
 */
export function StudentExportDialog({
  grade,
  classroom,
  scope,
  onClose,
}: {
  grade: string;
  classroom: string;
  scope: string;
  onClose: () => void;
}) {
  const [zones, setZones] = useState<string[]>(ALL_STUDENT_ZONE_KEYS);
  const [withdrawn, setWithdrawn] = useState(false);
  const all = zones.length === ALL_STUDENT_ZONE_KEYS.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (k: string) =>
    setZones((s) => (s.includes(k) ? s.filter((x) => x !== k) : ALL_STUDENT_ZONE_KEYS.filter((x) => x === k || s.includes(x))));

  const sp = new URLSearchParams();
  if (grade) sp.set('grade', grade);
  if (classroom) sp.set('classroom', classroom);
  if (!all) sp.set('zones', zones.join(','));
  if (withdrawn) sp.set('withdrawn', '1');
  const href = withBase(`/api/users/students/export?${sp}`);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="ส่งออกข้อมูลนักเรียน" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="card-header row-between">
          <span>ส่งออก Excel · {scope}</span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZones(ALL_STUDENT_ZONE_KEYS)}>เลือกทั้งหมด</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZones([])}>ล้าง</button>
          </span>
        </div>
        <div className="card-pad stack" style={{ gap: 14 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            ลำดับ ชั้น ห้อง เลขที่ รหัสนักเรียน คำนำหน้า ชื่อ นามสกุล มีในไฟล์เสมอ · เลือกโซนข้อมูลที่ต้องการเพิ่ม
          </p>
          <div className="exp-list">
            {STUDENT_EXPORT_ZONES.map((z) => (
              <label key={z.key} className={`exp-item${zones.includes(z.key) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={zones.includes(z.key)} onChange={() => toggle(z.key)} />
                <span>
                  {z.label}
                  {z.hint && <small className="muted"> ({z.hint})</small>}
                </span>
              </label>
            ))}
          </div>
          <label className="exp-item exp-names">
            <input type="checkbox" checked={withdrawn} onChange={(e) => setWithdrawn(e.target.checked)} />
            <span>
              รวมนักเรียนที่ลาออกแล้ว
              <small className="muted"> (เพิ่มคอลัมน์ “สถานะ” ท้ายตาราง)</small>
            </span>
          </label>
          {!all && (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              เลือกไม่ครบทุกโซน — ไฟล์นี้ใช้ดู/พิมพ์ได้ แต่นำเข้ากลับเข้าระบบไม่ได้
            </p>
          )}
          <div className="exp-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
            <a className="btn btn-primary" href={href} onClick={() => onClose()}>
              ส่งออก Excel
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

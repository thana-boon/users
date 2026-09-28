'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

interface Timetable {
  groups: { grade: string; sections: string[] }[];
  term: string | null;
}

/**
 * ชั้นที่สอน, read off the timetable service (see lib/timetable.ts).
 *
 * The timetable is the source of truth for who teaches which class, so when it
 * answers, its classes are what shows. When it does not (not configured, down,
 * slow) the stored `grade_taught` text from the import sheet shows instead, with
 * a line saying so — never an empty field that looks like "teaches nothing".
 */
export function TeachingClasses({
  url,
  stored,
  style,
}: {
  /** /api/users/me/teaching or /api/users/teachers/:id/teaching */
  url: string;
  stored: string | null;
  style?: React.CSSProperties;
}) {
  const [state, setState] = useState<'loading' | 'done'>('loading');
  const [tt, setTt] = useState<Timetable | null>(null);

  useEffect(() => {
    let live = true;
    setState('loading');
    api<{ timetable: Timetable | null }>(url)
      .then((r) => live && setTt(r.timetable))
      .catch(() => live && setTt(null))
      .finally(() => live && setState('done'));
    return () => {
      live = false;
    };
  }, [url]);

  const fallback = stored?.trim() || '—';
  let body: React.ReactNode;
  let hint: string;

  if (state === 'loading') {
    body = <input className="form-input" value="กำลังโหลดจากตารางสอน…" disabled readOnly />;
    hint = '';
  } else if (!tt) {
    body = <input className="form-input" value={fallback} disabled readOnly />;
    hint = 'ดึงข้อมูลจากระบบตารางสอนไม่ได้ — แสดงค่าที่บันทึกไว้ในระบบแทน';
  } else if (tt.groups.length === 0) {
    body = <input className="form-input" value={fallback} disabled readOnly />;
    hint = `ยังไม่มีคาบสอนในตารางสอน${tt.term ? ` ${tt.term}` : ''}`;
  } else {
    // Grade levels only (ม.3/1 + ม.3/2 → ม.3): which rooms is the timetable's
    // job to show; the profile answers "which ชั้น".
    body = (
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', paddingTop: 2 }}>
        {tt.groups.map((g) => (
          <span key={g.grade} className="chip">{g.grade}</span>
        ))}
      </div>
    );
    hint = `จากระบบตารางสอน${tt.term ? ` ${tt.term}` : ''}`;
  }

  return (
    <div style={style}>
      <label className="form-label">ชั้นที่สอน</label>
      {body}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

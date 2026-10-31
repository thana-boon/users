'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { TH_MONTHS_FULL, daysInThaiMonth, formatThaiDate } from '@/lib/thai';

/**
 * ปรับคำนำหน้าชื่อ — เด็กชาย → นาย, เด็กหญิง → นางสาว for students who have
 * turned 15 by a cutoff day (default 15 พ.ค.). Picking a day re-previews the
 * list; nothing is written until “ปรับคำนำหน้า” is confirmed. The server
 * re-derives the list from the saved cutoff, so what is applied is what the
 * preview showed.
 */

interface Candidate {
  id: number;
  studentCode: string;
  name: string;
  gradeLevel: string | null;
  classroom: string | null;
  birthDate: string;
  from: string;
  to: string;
}

interface Result {
  cutoff: { day: number; month: number };
  age: number;
  year: number;
  candidates: Candidate[];
  noBirthDate: number;
  changed?: number;
}

export default function PrefixUpdatePage() {
  const toast = useToast();
  const [data, setData] = useState<Result | null>(null);
  const [day, setDay] = useState(15);
  const [month, setMonth] = useState(5);
  const [busy, setBusy] = useState(false);

  const take = useCallback((r: Result) => {
    setData(r);
    setDay(r.cutoff.day);
    setMonth(r.cutoff.month);
  }, []);

  useEffect(() => {
    api<Result>('/api/users/prefix-update').then(take).catch((e) => toast(e.message, 'error'));
  }, [take, toast]);

  // 29 is allowed for กุมภาพันธ์ — the compare is by month/day.
  const maxDay = daysInThaiMonth(month, 2567);

  function pick(d: number, m: number) {
    const clamped = Math.min(d, daysInThaiMonth(m, 2567));
    setDay(clamped);
    setMonth(m);
    setBusy(true);
    api<Result>('/api/users/prefix-update', jsonBody({ day: clamped, month: m, apply: false }))
      .then(take)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false));
  }

  async function apply() {
    if (!data || data.candidates.length === 0) return;
    const n = data.candidates.length;
    if (!window.confirm(`ปรับคำนำหน้าชื่อนักเรียน ${n.toLocaleString('th-TH')} คน (เด็กชาย → นาย, เด็กหญิง → นางสาว) ใช่หรือไม่?`)) return;
    setBusy(true);
    try {
      const r = await api<Result>('/api/users/prefix-update', jsonBody({ day, month, apply: true }));
      take(r);
      toast(`ปรับคำนำหน้าชื่อแล้ว ${(r.changed ?? 0).toLocaleString('th-TH')} คน`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const list = data?.candidates ?? [];
  const boys = list.filter((c) => c.to === 'นาย').length;

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 1000 }}>
      <div>
        <h1 className="page-title">ปรับคำนำหน้าชื่อ</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          เปลี่ยน เด็กชาย → นาย และ เด็กหญิง → นางสาว ให้นักเรียนที่อายุครบ {data?.age ?? 15} ปี ภายในวันที่กำหนด
          (นับในปี ค.ศ. {data?.year ?? new Date().getFullYear()}) · ปรับเฉพาะนักเรียนที่ยังเรียนอยู่
        </p>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <b>นับอายุครบ {data?.age ?? 15} ปี ณ วันที่</b>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              ค่าเริ่มต้น 15 พฤษภาคม · เลือกแล้วระบบบันทึกวันที่และแสดงรายชื่อใหม่ทันที
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="form-select"
              style={{ width: 80 }}
              value={day}
              onChange={(e) => pick(Number(e.target.value), month)}
              disabled={busy || !data}
              aria-label="วันที่"
            >
              {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select
              className="form-select"
              style={{ width: 150 }}
              value={month}
              onChange={(e) => pick(day, Number(e.target.value))}
              disabled={busy || !data}
              aria-label="เดือน"
            >
              {TH_MONTHS_FULL.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid-3">
        <div className="stat"><span className="stat-label">จะปรับทั้งหมด</span><span className="stat-value">{list.length.toLocaleString('th-TH')}</span></div>
        <div className="stat"><span className="stat-label">เด็กชาย → นาย</span><span className="stat-value">{boys.toLocaleString('th-TH')}</span></div>
        <div className="stat"><span className="stat-label">เด็กหญิง → นางสาว</span><span className="stat-value">{(list.length - boys).toLocaleString('th-TH')}</span></div>
      </div>

      {data && data.noBirthDate > 0 && (
        <div className="alert alert-warning">
          มีนักเรียน {data.noBirthDate.toLocaleString('th-TH')} คนที่ยังเป็น เด็กชาย/เด็กหญิง แต่ไม่มีวันเกิดที่อ่านได้ — ระบบข้ามไป ต้องแก้วันเกิดก่อน
        </div>
      )}

      {!data && <div className="card" style={{ padding: 24 }}><div className="skeleton" style={{ height: 120 }} /></div>}

      {data && list.length === 0 && (
        <div className="card muted" style={{ padding: 40, textAlign: 'center' }}>
          ไม่มีนักเรียนที่ต้องปรับคำนำหน้าชื่อ ณ วันที่ {day} {TH_MONTHS_FULL[month - 1]}
        </div>
      )}

      {list.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header row-between">
            <span>รายชื่อที่จะปรับ</span>
            <button className="btn btn-primary" onClick={apply} disabled={busy}>
              {busy ? 'กำลังดำเนินการ…' : `ปรับคำนำหน้า ${list.length.toLocaleString('th-TH')} คน`}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ-สกุล</th>
                  <th>ชั้น/ห้อง</th>
                  <th>วันเกิด</th>
                  <th>คำนำหน้า</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.studentCode}</td>
                    <td>{c.name}</td>
                    <td>{c.gradeLevel ? `${c.gradeLevel}/${c.classroom ?? '-'}` : <span className="muted">ยังไม่จัดห้อง</span>}</td>
                    <td>{formatThaiDate(c.birthDate)}</td>
                    <td>{c.from} → <b>{c.to}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

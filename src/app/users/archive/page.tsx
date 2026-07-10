'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { IconSearch, IconRestore, IconTrash } from '@/components/Icons';
import { DeleteForeverDialog } from '@/components/DeleteForeverDialog';

/**
 * ถังขยะ — records removed with the ย้ายไปถังขยะ button (soft-delete,
 * is_archived) are hidden from every list but never destroyed. This page lists
 * archived นักเรียน + ครู and lets an admin restore (กู้คืน) them.
 */

interface ArchivedStudent {
  id: number; studentCode: string; prefix: string | null;
  firstName: string; lastName: string; nickname: string | null;
  status: string;
  lastGrade: string | null; lastRoom: string | null; lastYear: number | null;
}
interface ArchivedTeacher {
  id: number; teacherCode: string; prefix: string | null;
  firstName: string; lastName: string; subjectGroup: string | null; role: string;
}
interface ArchivedWorker {
  id: number; workerCode: string; prefix: string | null;
  firstName: string; lastName: string; position: string | null;
}

const fullName = (r: { prefix: string | null; firstName: string; lastName: string }) =>
  `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim();

const STATUS_LABEL: Record<string, string> = {
  studying: 'กำลังศึกษา', withdrawn: 'จำหน่าย/ลาออก', graduated: 'จบการศึกษา',
};

export default function ArchivePage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<'students' | 'teachers' | 'workers'>('students');
  const [students, setStudents] = useState<ArchivedStudent[]>([]);
  const [teachers, setTeachers] = useState<ArchivedTeacher[]>([]);
  const [workers, setWorkers] = useState<ArchivedWorker[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [delTarget, setDelTarget] = useState<
    { type: 'student' | 'teacher' | 'worker'; id: number; code: string; label: string } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ students: ArchivedStudent[]; teachers: ArchivedTeacher[]; workers: ArchivedWorker[] }>(
        '/api/users/archived',
      );
      setStudents(res.students);
      setTeachers(res.teachers);
      setWorkers(res.workers);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const term = q.trim().toLowerCase();
  const filteredStudents = useMemo(
    () => students.filter((s) =>
      !term || s.studentCode.toLowerCase().includes(term) ||
      fullName(s).toLowerCase().includes(term) ||
      (s.nickname ?? '').toLowerCase().includes(term)),
    [students, term],
  );
  const filteredTeachers = useMemo(
    () => teachers.filter((t) =>
      !term || t.teacherCode.toLowerCase().includes(term) ||
      fullName(t).toLowerCase().includes(term)),
    [teachers, term],
  );
  const filteredWorkers = useMemo(
    () => workers.filter((w) =>
      !term || w.workerCode.toLowerCase().includes(term) ||
      fullName(w).toLowerCase().includes(term) ||
      (w.position ?? '').toLowerCase().includes(term)),
    [workers, term],
  );

  async function restore(type: 'student' | 'teacher' | 'worker', row: { id: number; label: string }) {
    if (!(await confirm({
      title: 'กู้คืนรายการนี้',
      message: `กู้คืน “${row.label}” กลับเข้าระบบ? รายการจะกลับไปแสดงในทะเบียนตามเดิม`,
      confirmText: 'กู้คืน',
    }))) return;
    setRestoringId(row.id);
    try {
      await api('/api/users/archived', jsonBody({ type, id: row.id }));
      toast('กู้คืนแล้ว', 'success');
      if (type === 'student') setStudents((xs) => xs.filter((x) => x.id !== row.id));
      else if (type === 'teacher') setTeachers((xs) => xs.filter((x) => x.id !== row.id));
      else setWorkers((xs) => xs.filter((x) => x.id !== row.id));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="page-title"><IconTrash width={22} height={22} style={{ verticalAlign: '-4px', marginRight: 8 }} />ถังขยะ</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          นักเรียนและครูที่กด “ย้ายไปถังขยะ” จะถูกซ่อนจากทุกรายการ แต่ข้อมูลไม่ถูกลบจริง —
          กู้คืนกลับเข้าระบบได้ที่นี่ทุกเมื่อ หรือลบถาวรหากสร้างผิด.
        </p>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className={`btn btn-sm ${tab === 'students' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('students')}>
          นักเรียน ({students.length})
        </button>
        <button className={`btn btn-sm ${tab === 'teachers' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('teachers')}>
          ครู ({teachers.length})
        </button>
        <button className={`btn btn-sm ${tab === 'workers' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('workers')}>
          คนงาน ({workers.length})
        </button>
        <div className="spacer" />
        <div style={{ position: 'relative', maxWidth: 280, width: '100%' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--skdw-muted)' }}>
            <IconSearch width={15} height={15} />
          </span>
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="ค้นหาในถังขยะ…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          {tab === 'students' && (
            <table className="table">
              <thead>
                <tr>
                  <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ชื่อเล่น</th>
                  <th>ชั้น/ห้อง (ล่าสุด)</th><th>สถานะ</th><th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6}><div className="skeleton" style={{ height: 20 }} /></td></tr>}
                {!loading && filteredStudents.length === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                    {students.length === 0 ? 'ถังขยะว่าง — ยังไม่มีนักเรียนในถังขยะ' : 'ไม่พบรายชื่อที่ค้นหา'}
                  </td></tr>
                )}
                {filteredStudents.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">
                      <Link href={`/users/students/${s.id}`} style={{ color: 'var(--skdw-purple)' }}>{s.studentCode}</Link>
                    </td>
                    <td>{fullName(s)}</td>
                    <td className="muted">{s.nickname ?? '-'}</td>
                    <td>{s.lastGrade ?? '-'} / {s.lastRoom ?? '-'}{s.lastYear ? <span className="muted" style={{ fontSize: 12 }}> ({s.lastYear})</span> : null}</td>
                    <td><span className="badge badge-muted">{STATUS_LABEL[s.status] ?? s.status}</span></td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" disabled={restoringId === s.id}
                          onClick={() => restore('student', { id: s.id, label: `${s.studentCode} ${fullName(s)}` })}>
                          <IconRestore width={14} height={14} /> {restoringId === s.id ? 'กำลังกู้คืน…' : 'กู้คืน'}
                        </button>
                        <button className="btn btn-ghost btn-sm" title="ลบถาวร" style={{ color: 'var(--color-error)' }}
                          onClick={() => setDelTarget({ type: 'student', id: s.id, code: s.studentCode, label: `${s.studentCode} ${fullName(s)}` })}>
                          <IconTrash width={14} height={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'teachers' && (
            <table className="table">
              <thead>
                <tr>
                  <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>กลุ่มสาระ</th>
                  <th>สิทธิ์</th><th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5}><div className="skeleton" style={{ height: 20 }} /></td></tr>}
                {!loading && filteredTeachers.length === 0 && (
                  <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                    {teachers.length === 0 ? 'ถังขยะว่าง — ยังไม่มีครูในถังขยะ' : 'ไม่พบรายชื่อที่ค้นหา'}
                  </td></tr>
                )}
                {filteredTeachers.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">
                      <Link href={`/users/teachers/${t.id}`} style={{ color: 'var(--skdw-purple)' }}>{t.teacherCode}</Link>
                    </td>
                    <td>{fullName(t)}</td>
                    <td style={{ fontSize: 13 }}>{t.subjectGroup ?? '-'}</td>
                    <td><span className={`badge ${t.role === 'teacher-admin' ? 'badge-gold' : 'badge-muted'}`}>{t.role}</span></td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" disabled={restoringId === t.id}
                          onClick={() => restore('teacher', { id: t.id, label: `${t.teacherCode} ${fullName(t)}` })}>
                          <IconRestore width={14} height={14} /> {restoringId === t.id ? 'กำลังกู้คืน…' : 'กู้คืน'}
                        </button>
                        <button className="btn btn-ghost btn-sm" title="ลบถาวร" style={{ color: 'var(--color-error)' }}
                          onClick={() => setDelTarget({ type: 'teacher', id: t.id, code: t.teacherCode, label: `${t.teacherCode} ${fullName(t)}` })}>
                          <IconTrash width={14} height={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'workers' && (
            <table className="table">
              <thead>
                <tr>
                  <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={4}><div className="skeleton" style={{ height: 20 }} /></td></tr>}
                {!loading && filteredWorkers.length === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                    {workers.length === 0 ? 'ถังขยะว่าง — ยังไม่มีคนงานในถังขยะ' : 'ไม่พบรายชื่อที่ค้นหา'}
                  </td></tr>
                )}
                {filteredWorkers.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">
                      <Link href={`/users/workers/${w.id}`} style={{ color: 'var(--skdw-purple)' }}>{w.workerCode}</Link>
                    </td>
                    <td>{fullName(w)}</td>
                    <td style={{ fontSize: 13 }}>{w.position ?? '-'}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" disabled={restoringId === w.id}
                          onClick={() => restore('worker', { id: w.id, label: `${w.workerCode} ${fullName(w)}` })}>
                          <IconRestore width={14} height={14} /> {restoringId === w.id ? 'กำลังกู้คืน…' : 'กู้คืน'}
                        </button>
                        <button className="btn btn-ghost btn-sm" title="ลบถาวร" style={{ color: 'var(--color-error)' }}
                          onClick={() => setDelTarget({ type: 'worker', id: w.id, code: w.workerCode, label: `${w.workerCode} ${fullName(w)}` })}>
                          <IconTrash width={14} height={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {delTarget && (
        <DeleteForeverDialog
          type={delTarget.type}
          id={delTarget.id}
          code={delTarget.code}
          label={delTarget.label}
          onClose={() => setDelTarget(null)}
          onDone={() => {
            const { type, id } = delTarget;
            if (type === 'student') setStudents((xs) => xs.filter((x) => x.id !== id));
            else if (type === 'teacher') setTeachers((xs) => xs.filter((x) => x.id !== id));
            else setWorkers((xs) => xs.filter((x) => x.id !== id));
            setDelTarget(null);
          }}
        />
      )}
    </div>
  );
}

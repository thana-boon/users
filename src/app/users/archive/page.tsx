'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { IconSearch, IconRestore, IconTrash } from '@/components/Icons';
import {
  DeleteForeverDialog,
  TRASH_KIND_LABEL,
  type TrashKind,
} from '@/components/DeleteForeverDialog';
import { BulkDeleteForeverDialog } from '@/components/BulkDeleteForeverDialog';

/**
 * ถังขยะ — records removed with the ย้ายไปถังขยะ button (soft-delete,
 * is_archived) are hidden from every list but never destroyed. This page lists
 * archived นักเรียน / ครู / คนงาน / อาจารย์พิเศษ and lets an admin restore
 * (กู้คืน) them.
 *
 * Rows are kept in one map keyed by the same `TrashKind` the API's `type` field
 * uses, so the tab, the restore call, the delete dialog and the "which list do
 * I drop the row from" step all read from a single value.
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
interface ArchivedSpecialTeacher {
  id: number; specialTeacherCode: string; prefix: string | null;
  firstName: string; lastName: string; subjectGroup: string | null;
}

interface Trash {
  student: ArchivedStudent[];
  teacher: ArchivedTeacher[];
  worker: ArchivedWorker[];
  special_teacher: ArchivedSpecialTeacher[];
}

const EMPTY: Trash = { student: [], teacher: [], worker: [], special_teacher: [] };

const TABS: TrashKind[] = ['student', 'teacher', 'worker', 'special_teacher'];

const fullName = (r: { prefix: string | null; firstName: string; lastName: string }) =>
  `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim();

/** Free-text search over whichever fields a tab shows. Empty term matches all. */
const matches = (term: string, ...fields: (string | null)[]) =>
  !term || fields.some((f) => (f ?? '').toLowerCase().includes(term));

const STATUS_LABEL: Record<string, string> = {
  studying: 'กำลังศึกษา', withdrawn: 'จำหน่าย/ลาออก', graduated: 'จบการศึกษา',
};

export default function ArchivePage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<TrashKind>('student');
  const [trash, setTrash] = useState<Trash>(EMPTY);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [delTarget, setDelTarget] = useState<
    { type: TrashKind; id: number; code: string; label: string } | null
  >(null);
  const [bulkDel, setBulkDel] = useState<TrashKind | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{
        students: ArchivedStudent[];
        teachers: ArchivedTeacher[];
        workers: ArchivedWorker[];
        specialTeachers: ArchivedSpecialTeacher[];
      }>('/api/users/archived');
      setTrash({
        student: res.students,
        teacher: res.teachers,
        worker: res.workers,
        special_teacher: res.specialTeachers ?? [],
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  /** Drop one row (or every row of a kind) from the list already on screen. */
  const drop = useCallback((kind: TrashKind, id: number | 'all') => {
    setTrash((t) => ({
      ...t,
      [kind]: id === 'all' ? [] : (t[kind] as { id: number }[]).filter((x) => x.id !== id),
    }));
  }, []);

  const term = q.trim().toLowerCase();

  const filteredStudents = useMemo(
    () => trash.student.filter((s) => matches(term, s.studentCode, fullName(s), s.nickname)),
    [trash.student, term],
  );
  const filteredTeachers = useMemo(
    () => trash.teacher.filter((t) => matches(term, t.teacherCode, fullName(t))),
    [trash.teacher, term],
  );
  const filteredWorkers = useMemo(
    () => trash.worker.filter((w) => matches(term, w.workerCode, fullName(w), w.position)),
    [trash.worker, term],
  );
  const filteredSpecialTeachers = useMemo(
    () => trash.special_teacher.filter((s) => matches(term, s.specialTeacherCode, fullName(s), s.subjectGroup)),
    [trash.special_teacher, term],
  );

  async function restore(type: TrashKind, row: { id: number; label: string }) {
    if (!(await confirm({
      title: 'กู้คืนรายการนี้',
      message: `กู้คืน “${row.label}” กลับเข้าระบบ? รายการจะกลับไปแสดงในทะเบียนตามเดิม`,
      confirmText: 'กู้คืน',
    }))) return;
    setRestoringId(row.id);
    try {
      await api('/api/users/archived', jsonBody({ type, id: row.id }));
      toast('กู้คืนแล้ว', 'success');
      drop(type, row.id);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setRestoringId(null);
    }
  }

  const activeCount = trash[tab].length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="page-title"><IconTrash width={22} height={22} style={{ verticalAlign: '-4px', marginRight: 8 }} />ถังขยะ</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          นักเรียนและบุคลากรที่กด “ย้ายไปถังขยะ” จะถูกซ่อนจากทุกรายการ แต่ข้อมูลไม่ถูกลบจริง —
          กู้คืนกลับเข้าระบบได้ที่นี่ทุกเมื่อ หรือลบถาวรหากสร้างผิด.
        </p>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((k) => (
          <button
            key={k}
            className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(k)}
          >
            {TRASH_KIND_LABEL[k]} ({trash[k].length})
          </button>
        ))}
        <div className="spacer" />
        <div style={{ position: 'relative', maxWidth: 280, width: '100%' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--skdw-muted)' }}>
            <IconSearch width={15} height={15} />
          </span>
          <input className="form-input" style={{ paddingLeft: 32 }} placeholder="ค้นหาในถังขยะ…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button
          className="btn btn-sm btn-danger"
          disabled={loading || activeCount === 0}
          title={activeCount === 0 ? 'ถังขยะว่าง' : 'ลบทุกรายการในแท็บนี้ออกจากฐานข้อมูลอย่างถาวร'}
          onClick={() => setBulkDel(tab)}
        >
          <IconTrash width={14} height={14} /> ลบทั้งหมด ({activeCount})
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          {tab === 'student' && (
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
                    {trash.student.length === 0 ? 'ถังขยะว่าง — ยังไม่มีนักเรียนในถังขยะ' : 'ไม่พบรายชื่อที่ค้นหา'}
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
          {tab === 'teacher' && (
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
                    {trash.teacher.length === 0 ? 'ถังขยะว่าง — ยังไม่มีครูในถังขยะ' : 'ไม่พบรายชื่อที่ค้นหา'}
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
          {tab === 'worker' && (
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
                    {trash.worker.length === 0 ? 'ถังขยะว่าง — ยังไม่มีคนงานในถังขยะ' : 'ไม่พบรายชื่อที่ค้นหา'}
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
          {tab === 'special_teacher' && (
            <table className="table">
              <thead>
                <tr>
                  <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>กลุ่มสาระ</th><th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={4}><div className="skeleton" style={{ height: 20 }} /></td></tr>}
                {!loading && filteredSpecialTeachers.length === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                    {trash.special_teacher.length === 0 ? 'ถังขยะว่าง — ยังไม่มีอาจารย์พิเศษในถังขยะ' : 'ไม่พบรายชื่อที่ค้นหา'}
                  </td></tr>
                )}
                {filteredSpecialTeachers.map((s) => (
                  <tr key={s.id}>
                    {/* อาจารย์พิเศษ have no detail page — the whole record is on
                        the list page — so the code is plain text, not a link. */}
                    <td className="mono">{s.specialTeacherCode}</td>
                    <td>{fullName(s)}</td>
                    <td style={{ fontSize: 13 }}>{s.subjectGroup ?? '-'}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" disabled={restoringId === s.id}
                          onClick={() => restore('special_teacher', { id: s.id, label: `${s.specialTeacherCode} ${fullName(s)}` })}>
                          <IconRestore width={14} height={14} /> {restoringId === s.id ? 'กำลังกู้คืน…' : 'กู้คืน'}
                        </button>
                        <button className="btn btn-ghost btn-sm" title="ลบถาวร" style={{ color: 'var(--color-error)' }}
                          onClick={() => setDelTarget({ type: 'special_teacher', id: s.id, code: s.specialTeacherCode, label: `${s.specialTeacherCode} ${fullName(s)}` })}>
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
            drop(delTarget.type, delTarget.id);
            setDelTarget(null);
          }}
        />
      )}

      {bulkDel && (
        <BulkDeleteForeverDialog
          type={bulkDel}
          count={trash[bulkDel].length}
          onClose={() => setBulkDel(null)}
          onDone={() => {
            drop(bulkDel, 'all');
            setBulkDel(null);
          }}
        />
      )}
    </div>
  );
}

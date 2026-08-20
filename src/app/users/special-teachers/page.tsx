'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, jsonBody, withBase } from '@/lib/client';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/Confirm';
import { Combo } from '@/components/Combo';
import { SubjectGroupSelect, SubjectGroupFilter } from '@/components/SubjectGroupSelect';
import { ImportDialog } from '@/components/ImportDialog';
import { PhotoImportDialog } from '@/components/PhotoImportDialog';
import { PhotoThumb, PhotoLightbox } from '@/components/PhotoThumb';
import { PhotoCard } from '@/components/PhotoCard';
import {
  IconSearch, IconPlus, IconEdit, IconTrash, IconUpload, IconDownload, IconImage,
} from '@/components/Icons';
import { STAFF_PREFIX_OPTIONS } from '@/lib/options';

/**
 * อาจารย์พิเศษ — วิทยากร/ครูพิเศษที่มาสอนเป็นรายวิชา.
 *
 * They hold no account, so this page has no รหัสผ่าน/สิทธิ์ column and no detail
 * page behind it: รหัส + ชื่อ + กลุ่มสาระ + รูป is the entire record, which fits
 * in the same dialog that creates it. The photo is the one field that cannot be
 * set before the row exists, so it appears in the dialog only when editing.
 */

interface Row {
  id: number;
  specialTeacherCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  subjectGroup: string | null;
  phone: string | null;
  hasPhoto: boolean;
}

export default function SpecialTeachersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const search = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  // Seeded from ?subjectGroup= so the counts on the กลุ่มสาระ page link straight
  // to the people in that group.
  const [subjectGroup, setSubjectGroup] = useState(search.get('subjectGroup') ?? '');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [zoom, setZoom] = useState<Row | null>(null);
  const pageSize = 25;
  const deb = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (q) sp.set('q', q);
      if (subjectGroup) sp.set('subjectGroup', subjectGroup);
      const res = await api<{ data: Row[]; total: number }>(`/api/users/special-teachers?${sp}`);
      setRows(res.data); setTotal(res.total); setPage(p);
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [q, subjectGroup, toast]);

  useEffect(() => {
    clearTimeout(deb.current);
    deb.current = setTimeout(() => load(1), 300);
    return () => clearTimeout(deb.current);
  }, [q, subjectGroup, load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function archive(r: Row) {
    if (!(await confirm({
      title: 'ย้ายไปถังขยะ',
      message: `ย้าย “${r.prefix ?? ''}${r.firstName} ${r.lastName}” ไปถังขยะ? ข้อมูลจะไม่หาย แต่จะไม่แสดงในรายการ`,
      confirmText: 'ย้ายไปถังขยะ',
      danger: true,
    }))) return;
    try {
      await api(`/api/users/special-teachers/${r.id}`, { method: 'DELETE' });
      toast('ย้ายไปถังขยะแล้ว', 'success');
      load(page);
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <div>
          <h1 className="page-title">อาจารย์พิเศษ</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
            วิทยากร/อาจารย์พิเศษที่มาสอน — ไม่มีบัญชีเข้าสู่ระบบและไม่มีรหัสผ่าน เก็บเป็นรายชื่อตามกลุ่มสาระเท่านั้น
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <a className="btn btn-ghost btn-sm" href={withBase('/api/users/special-teachers/template')}>เทมเพลต</a>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)}>
            <IconUpload width={16} height={16} /> นำเข้า
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPhotos(true)}>
            <IconImage width={16} height={16} /> นำเข้ารูป
          </button>
          <a className="btn btn-secondary btn-sm" href={withBase('/api/users/special-teachers/export')}>
            <IconDownload width={16} height={16} /> ส่งออก
          </a>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <IconPlus width={16} height={16} /> เพิ่ม
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--skdw-muted)' }}>
              <IconSearch width={18} height={18} />
            </span>
            <input
              className="form-input"
              style={{ paddingLeft: 38 }}
              placeholder="ค้นหารหัส / ชื่อ / กลุ่มสาระ"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="ค้นหาอาจารย์พิเศษ"
            />
          </div>
          <SubjectGroupFilter value={subjectGroup} onChange={setSubjectGroup} />
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>รูป</th>
                <th>รหัส</th><th>ชื่อ-นามสกุล</th><th>กลุ่มสาระ</th><th>เบอร์โทร</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={6}><div className="skeleton" style={{ height: 20 }} /></td></tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                    {!q && !subjectGroup
                      ? 'ยังไม่มีอาจารย์พิเศษในระบบ — กด “เพิ่ม” เพื่อเริ่ม'
                      : 'ไม่พบอาจารย์พิเศษที่ค้นหา'}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ paddingTop: 6, paddingBottom: 6 }}>
                    <PhotoThumb
                      src={r.hasPhoto ? `/api/users/special-teachers/${r.id}/photo` : null}
                      initials={(r.firstName[0] ?? '') + (r.lastName[0] ?? '')}
                      alt={`${r.firstName} ${r.lastName}`}
                      onClick={() => setZoom(r)}
                    />
                  </td>
                  <td className="mono">{r.specialTeacherCode}</td>
                  <td>{r.prefix ?? ''}{r.firstName} {r.lastName}</td>
                  <td style={{ fontSize: 13 }}>{r.subjectGroup ?? '-'}</td>
                  <td className="mono" style={{ fontSize: 13 }}>{r.phone ?? '-'}</td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>
                        <IconEdit width={14} height={14} /> แก้ไข
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="ย้ายไปถังขยะ"
                        style={{ color: 'var(--color-error)' }}
                        onClick={() => archive(r)}
                      >
                        <IconTrash width={14} height={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-between" style={{ padding: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>ทั้งหมด {total.toLocaleString('th-TH')} คน</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>ก่อนหน้า</button>
            <span className="mono" style={{ fontSize: 13 }}>{page} / {pages}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= pages || loading} onClick={() => load(page + 1)}>ถัดไป</button>
          </div>
        </div>
      </div>

      {showImport && (
        <ImportDialog
          kind="special-teachers"
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); load(1); }}
        />
      )}
      {showPhotos && (
        <PhotoImportDialog
          endpoint="/api/users/special-teachers/photos"
          title="นำเข้ารูปอาจารย์พิเศษ"
          hint="ตั้งชื่อไฟล์รูปให้ตรงกับ “รหัสอาจารย์พิเศษ” เช่น"
          codeExample="SP001.jpg"
          onClose={() => setShowPhotos(false)}
          onDone={() => { setShowPhotos(false); load(page); }}
        />
      )}
      {zoom && (
        <PhotoLightbox
          src={`/api/users/special-teachers/${zoom.id}/photo`}
          alt={`${zoom.firstName} ${zoom.lastName}`}
          caption={`${zoom.specialTeacherCode} · ${zoom.prefix ?? ''}${zoom.firstName} ${zoom.lastName}`}
          onClose={() => setZoom(null)}
        />
      )}

      {editing && (
        <SpecialTeacherDialog
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            const wasNew = editing === 'new';
            setEditing(null);
            load(wasNew ? 1 : page);
            toast(wasNew ? 'เพิ่มอาจารย์พิเศษแล้ว' : 'บันทึกแล้ว', 'success');
          }}
        />
      )}
    </div>
  );
}

function SpecialTeacherDialog({
  row, onClose, onDone,
}: {
  row: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Photo state is local to the dialog: uploading writes straight through to
  // /[id]/photo, so it is already saved by the time บันทึก is pressed. The list
  // is reloaded on close either way, which is what refreshes the thumbnail.
  const [hasPhoto, setHasPhoto] = useState(row?.hasPhoto ?? false);
  const [f, setF] = useState({
    specialTeacherCode: row?.specialTeacherCode ?? '',
    prefix: row?.prefix ?? 'นาย',
    firstName: row?.firstName ?? '',
    lastName: row?.lastName ?? '',
    subjectGroup: row?.subjectGroup ?? '',
    phone: row?.phone ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const setV = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    if (!f.specialTeacherCode.trim() || !f.firstName.trim() || !f.lastName.trim()) {
      toast('กรุณากรอกรหัส/ชื่อ/นามสกุล', 'error');
      return;
    }
    setBusy(true);
    try {
      if (row) await api(`/api/users/special-teachers/${row.id}`, { method: 'PATCH', body: JSON.stringify(f) });
      else await api('/api/users/special-teachers', jsonBody(f));
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  const initials = `${f.firstName[0] ?? ''}${f.lastName[0] ?? ''}`.trim();

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={row ? 'แก้ไขอาจารย์พิเศษ' : 'เพิ่มอาจารย์พิเศษ'}>
      <div className="modal">
        <div className="card-header">{row ? 'แก้ไขอาจารย์พิเศษ' : 'เพิ่มอาจารย์พิเศษ'}</div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {row ? (
              <PhotoCard
                baseEndpoint={`/api/users/special-teachers/${row.id}/photo`}
                hasPhoto={hasPhoto}
                initials={initials}
                alt="รูปอาจารย์พิเศษ"
                onChange={setHasPhoto}
              />
            ) : (
              <div className="stack" style={{ gap: 8, alignItems: 'center', width: 116 }}>
                <div style={{
                  width: 116, height: 155, borderRadius: 12, background: 'var(--skdw-purple-pale)',
                  display: 'grid', placeItems: 'center', border: '1px dashed var(--skdw-border)',
                  color: 'var(--skdw-purple)', fontSize: 34, fontWeight: 700,
                }}>
                  {initials || '—'}
                </div>
                <p className="form-hint" style={{ textAlign: 'center', margin: 0 }}>
                  บันทึกก่อน แล้วจึงใส่รูปได้
                </p>
              </div>
            )}
            <div className="stack" style={{ gap: 12, flex: 1, minWidth: 240 }}>
              <div className="grid-2">
                <div>
                  <label className="form-label required">รหัสอาจารย์พิเศษ</label>
                  <input className="form-input mono" value={f.specialTeacherCode} onChange={set('specialTeacherCode')} placeholder="SP001" />
                </div>
                <Combo label="คำนำหน้า" value={f.prefix} onChange={setV('prefix')} options={STAFF_PREFIX_OPTIONS} />
              </div>
              <div className="grid-2">
                <div><label className="form-label required">ชื่อ</label><input className="form-input" value={f.firstName} onChange={set('firstName')} /></div>
                <div><label className="form-label required">นามสกุล</label><input className="form-input" value={f.lastName} onChange={set('lastName')} /></div>
              </div>
            </div>
          </div>
          <SubjectGroupSelect
            label="กลุ่มสาระ"
            value={f.subjectGroup}
            onChange={setV('subjectGroup')}
            hint="กลุ่มสาระที่อาจารย์พิเศษคนนี้สังกัด — ใช้รายการเดียวกับครูประจำ แก้ไขได้ที่หน้า “กลุ่มสาระ”"
          />
          <div>
            <label className="form-label">เบอร์โทร</label>
            <input className="form-input" value={f.phone} onChange={set('phone')} placeholder="เช่น 0812345678" />
          </div>
          <p className="form-hint">อาจารย์พิเศษไม่มีบัญชีเข้าสู่ระบบ จึงไม่ต้องกรอกรหัสผ่านหรืออีเมล</p>
        </div>
        <div className="row-between card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}

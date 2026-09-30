'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconTrash } from './Icons';
import { useConfirm } from './Confirm';
import { sameValues, useUnsavedChanges } from '@/lib/useUnsavedChanges';

/**
 * A list of identical sub-records that the user adds to and deletes from —
 * วุฒิการศึกษา, วุฒิทางลูกเสือ, การผ่านอบรม. One teacher holds any number of
 * each, so none of them can be a fixed block of fields the way ที่อยู่ or
 * ผู้ปกครอง are.
 *
 * Each row is its own little record: saved rows show as a summary card with
 * แก้ไข / ลบ, and "เพิ่ม" or แก้ไข opens ONE editor with its own บันทึก and
 * ยกเลิก. Typing into a blank grid of inputs and hoping the page-level save
 * picks it up confused people; this way a row is either on file or visibly
 * being edited.
 *
 * The committed rows live in the PARENT's state. `onChange` is how a row is
 * saved — the parent persists the new list (and may return a promise; if it
 * rejects, the editor stays open with the draft intact). Only the open draft is
 * held here. Rows are keyed by index: nothing reorders them, and a new row's
 * editor is rendered apart from the list rather than at an index, so a row
 * added meanwhile (the scout quick-pick) cannot shift it.
 *
 * `readOnly` renders the same summaries without the buttons — the shape a
 * teacher sees for a list they may look at but not change.
 */
export function RepeatList<T extends object>({
  title,
  hint,
  rows,
  onChange,
  blank,
  renderRow,
  renderSummary,
  addLabel = 'เพิ่มรายการ',
  emptyLabel = 'ยังไม่มีข้อมูล',
  readOnly = false,
  toolbar,
  required,
}: {
  title: string;
  hint?: string;
  rows: T[];
  /** Save the whole list. A rejected promise keeps the editor open. */
  onChange: (rows: T[]) => void | Promise<unknown>;
  /** A blank row — what "เพิ่ม" opens. */
  blank: () => T;
  /**
   * The row's fields. `set` writes one field of the row being edited; `err`
   * is the message for a required field left blank at บันทึก (undefined
   * otherwise) — hand it to the field's `error` so the box itself turns red.
   */
  renderRow: (
    row: T,
    set: (k: keyof T) => (v: string) => void,
    err: (k: keyof T) => string | undefined,
  ) => React.ReactNode;
  /** The saved row as a card: a title line and a muted detail line. */
  renderSummary?: (row: T) => React.ReactNode;
  addLabel?: string;
  emptyLabel?: string;
  readOnly?: boolean;
  /** Extra controls under the title (editable mode only) — e.g. a quick multi-pick. */
  toolbar?: React.ReactNode;
  /**
   * Fields a row cannot be saved without, keyed to the label the message names
   * — or a function of the row, when what is required depends on another field.
   * Checked here, on บันทึก, not by the API: rows saved before a field became
   * required must still load and be deletable. The fields' labels carry the *.
   */
  required?: RequiredMap<T> | ((row: T) => RequiredMap<T>);
}) {
  const confirm = useConfirm();
  const phone = useMedia('(max-width: 640px)');
  // The one open editor: an existing row by index, or a new row ('new').
  const [editing, setEditing] = useState<{ at: number | 'new'; draft: T } | null>(null);
  const [busy, setBusy] = useState(false);
  // Keys of the required fields found blank at the last บันทึก.
  const [missing, setMissing] = useState<string[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);

  const original = editing ? (editing.at === 'new' ? blank() : rows[editing.at]) : null;
  const changed = editing !== null && !sameValues(editing.draft, original);
  useUnsavedChanges(changed);

  const requiredFor = (row: T): RequiredMap<T> =>
    (typeof required === 'function' ? required(row) : required) ?? {};

  const set = (k: keyof T) => (v: string) => {
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));
    // Filling a flagged field clears its red straight away.
    if (v.trim()) setMissing((m) => m.filter((x) => x !== k));
  };

  const err = (k: keyof T): string | undefined => {
    if (!editing || !missing.includes(k as string)) return undefined;
    const name = requiredFor(editing.draft)[k];
    return name ? `กรุณากรอก${name}` : undefined;
  };

  const blanks = (row: T) =>
    Object.keys(requiredFor(row)).filter(
      (k) => !String((row as Record<string, unknown>)[k] ?? '').trim(),
    );

  const open = (next: { at: number | 'new'; draft: T } | null) => {
    setMissing([]);
    setEditing(next);
  };

  async function commit(next: T[]): Promise<boolean> {
    setBusy(true);
    try {
      await onChange(next);
      return true;
    } catch {
      // The parent has already said what went wrong.
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editing) return;
    const gaps = blanks(editing.draft);
    setMissing(gaps);
    if (gaps.length) {
      // Take the person to the first red field — on a phone the บันทึก button
      // is a long way below it.
      requestAnimationFrame(() => {
        editorRef.current
          ?.querySelector('[aria-invalid="true"]')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    const next =
      editing.at === 'new'
        ? [...rows, editing.draft]
        : rows.map((r, j) => (j === editing.at ? editing.draft : r));
    if (await commit(next)) open(null);
  }

  async function cancel() {
    if (changed && !(await confirm({
      title: 'ยกเลิกการแก้ไข',
      message: 'ข้อมูลที่พิมพ์ในรายการนี้ยังไม่ได้บันทึก จะทิ้งไปหรือไม่?',
      confirmText: 'ทิ้งการแก้ไข',
      danger: true,
    }))) return;
    open(null);
  }

  async function remove(i: number) {
    if (!(await confirm({
      title: `ลบรายการที่ ${i + 1}`,
      message: 'ลบรายการนี้ออกจากข้อมูลหรือไม่?',
      confirmText: 'ลบ',
      danger: true,
    }))) return;
    await commit(rows.filter((_, j) => j !== i));
  }

  const hasRequired = editing !== null && Object.keys(requiredFor(editing.draft)).length > 0;
  const missingNames = editing
    ? missing.map((k) => requiredFor(editing.draft)[k as keyof T]).filter(Boolean)
    : [];
  // With required fields, a blank row's บันทึก stays pressable: pressing it
  // says what to fill in, where a greyed-out button says nothing.
  const saveDisabled = busy || (editing !== null && !hasRequired && sameValues(editing.draft, blank()));
  const legend = hasRequired && (
    <div className="muted" style={{ fontSize: 12 }}><span style={{ color: 'var(--color-error)' }}>*</span> ต้องกรอก</div>
  );
  const missingNote = missingNames.length > 0 && (
    <p className="form-error" role="alert" style={{ marginTop: 12, fontSize: 13 }}>
      ยังไม่ได้กรอก: {missingNames.join(', ')}
    </p>
  );

  const editor = (label: string) =>
    phone ? (
      // A phone gets the row as a full-screen sheet: the fields scroll, and
      // บันทึก stays pinned under the thumb instead of six fields down.
      <EditorSheet
        title={title}
        label={label}
        busy={busy}
        saveDisabled={saveDisabled}
        onSave={save}
        onCancel={cancel}
        legend={legend}
      >
        <div ref={editorRef}>
          <div className="grid-2" style={{ gap: 16 }}>{renderRow(editing!.draft, set, err)}</div>
          {missingNote}
        </div>
      </EditorSheet>
    ) : (
      <div ref={editorRef} style={{ ...boxStyle, borderColor: 'var(--skdw-purple)', borderWidth: 1 }}>
        <div className="row-between" style={{ marginBottom: 10, gap: 8 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
          {legend}
        </div>
        <div className="grid-2" style={{ gap: 12 }}>{renderRow(editing!.draft, set, err)}</div>
        {missingNote}
        <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saveDisabled}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกรายการนี้'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} disabled={busy}>
            ยกเลิก
          </button>
          {changed && (
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>ยังไม่ได้บันทึก</span>
          )}
        </div>
      </div>
    );

  return (
    <div className="card">
      <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: hint ? 2 : 0 }}>{title}</h2>
          {hint && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{hint}</p>}
        </div>
        <span className="badge badge-muted">{rows.length} รายการ</span>
      </div>

      {!readOnly && toolbar}

      {rows.length === 0 && editing?.at !== 'new' && (
        <p className="muted" style={{ fontSize: 13, margin: '12px 0 0' }}>{emptyLabel}</p>
      )}

      <div className="stack" style={{ gap: 12, marginTop: 12 }}>
        {rows.map((row, i) =>
          editing?.at === i ? (
            <div key={i}>{editor(`แก้ไขรายการที่ ${i + 1}`)}</div>
          ) : (
            <div key={i} style={boxStyle}>
              <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div style={{ fontSize: 14, minWidth: 0 }}>{renderSummary?.(row) ?? null}</div>
                {!readOnly && (
                  <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => open({ at: i, draft: { ...row } })}
                      disabled={busy || editing !== null}
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => remove(i)}
                      disabled={busy || editing !== null}
                      aria-label={`ลบรายการที่ ${i + 1}`}
                    >
                      <IconTrash width={14} height={14} /> ลบ
                    </button>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {editing?.at === 'new' && editor(`รายการใหม่ (รายการที่ ${rows.length + 1})`)}
      </div>

      {!readOnly && editing === null && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 12 }}
          onClick={() => open({ at: 'new', draft: blank() })}
          disabled={busy}
        >
          + {addLabel}
        </button>
      )}
      {!readOnly && editing !== null && (
        <p className="muted" style={{ fontSize: 12, margin: '12px 0 0' }}>
          กด “บันทึกรายการนี้” หรือ “ยกเลิก” ก่อน จึงจะเพิ่มหรือแก้ไขรายการอื่นได้
        </p>
      )}
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  border: '0.5px solid var(--skdw-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
  background: 'var(--skdw-bg)',
};

type RequiredMap<T> = Partial<Record<keyof T, string>>;

/** A media query as state, read after mount so server and first client render agree. */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return on;
}

/**
 * The phone editor: the whole screen, a header with ยกเลิก, the fields in a
 * scrolling body and บันทึก pinned at the bottom. It follows `visualViewport`,
 * so with the keyboard up the button sits on the keyboard rather than under it.
 * Below --z-modal, so the "ทิ้งการแก้ไข?" confirm still opens on top of it, and
 * below Combo's sheet, which opens from inside it.
 */
function EditorSheet({
  title,
  label,
  busy,
  saveDisabled,
  onSave,
  onCancel,
  legend,
  children,
}: {
  title: string;
  label: string;
  busy: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  onCancel: () => void;
  legend: React.ReactNode;
  children: React.ReactNode;
}) {
  const [vp, setVp] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const sync = () => setVp(vv ? { top: vv.offsetTop, height: vv.height } : null);
    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    const html = document.documentElement;
    const prev = [html.style.overflow, document.body.style.overflow];
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      html.style.overflow = prev[0];
      document.body.style.overflow = prev[1];
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="rl-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — ${label}`}
      style={vp ? { top: vp.top, height: vp.height, bottom: 'auto' } : undefined}
    >
      <div className="rl-sheet-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>ยกเลิก</button>
        <div className="rl-sheet-title">
          <div>{title}</div>
          <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{label}</div>
        </div>
        <div style={{ minWidth: 64, textAlign: 'right' }}>{legend}</div>
      </div>
      <div className="rl-sheet-body">{children}</div>
      <div className="rl-sheet-foot">
        <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={onSave} disabled={saveDisabled}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกรายการนี้'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

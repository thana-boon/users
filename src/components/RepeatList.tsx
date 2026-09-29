'use client';

import { useState } from 'react';
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
}: {
  title: string;
  hint?: string;
  rows: T[];
  /** Save the whole list. A rejected promise keeps the editor open. */
  onChange: (rows: T[]) => void | Promise<unknown>;
  /** A blank row — what "เพิ่ม" opens. */
  blank: () => T;
  /** The row's fields. `set` writes one field of the row being edited. */
  renderRow: (row: T, set: (k: keyof T) => (v: string) => void) => React.ReactNode;
  /** The saved row as a card: a title line and a muted detail line. */
  renderSummary?: (row: T) => React.ReactNode;
  addLabel?: string;
  emptyLabel?: string;
  readOnly?: boolean;
  /** Extra controls under the title (editable mode only) — e.g. a quick multi-pick. */
  toolbar?: React.ReactNode;
}) {
  const confirm = useConfirm();
  // The one open editor: an existing row by index, or a new row ('new').
  const [editing, setEditing] = useState<{ at: number | 'new'; draft: T } | null>(null);
  const [busy, setBusy] = useState(false);

  const original = editing ? (editing.at === 'new' ? blank() : rows[editing.at]) : null;
  const changed = editing !== null && !sameValues(editing.draft, original);
  useUnsavedChanges(changed);

  const set = (k: keyof T) => (v: string) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));

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
    const next =
      editing.at === 'new'
        ? [...rows, editing.draft]
        : rows.map((r, j) => (j === editing.at ? editing.draft : r));
    if (await commit(next)) setEditing(null);
  }

  async function cancel() {
    if (changed && !(await confirm({
      title: 'ยกเลิกการแก้ไข',
      message: 'ข้อมูลที่พิมพ์ในรายการนี้ยังไม่ได้บันทึก จะทิ้งไปหรือไม่?',
      confirmText: 'ทิ้งการแก้ไข',
      danger: true,
    }))) return;
    setEditing(null);
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

  const editor = (label: string) => (
    <div style={{ ...boxStyle, borderColor: 'var(--skdw-purple)', borderWidth: 1 }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>{label}</div>
      <div className="grid-2" style={{ gap: 12 }}>{renderRow(editing!.draft, set)}</div>
      <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={save}
          disabled={busy || sameValues(editing!.draft, blank())}
        >
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
                      onClick={() => setEditing({ at: i, draft: { ...row } })}
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
          onClick={() => setEditing({ at: 'new', draft: blank() })}
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

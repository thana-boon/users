'use client';

import { IconTrash } from './Icons';

/**
 * A list of identical sub-records that the user adds to and deletes from —
 * วุฒิการศึกษา, วุฒิทางลูกเสือ, การผ่านอบรม. One teacher holds any number of
 * each, so none of them can be a fixed block of fields the way ที่อยู่ or
 * ผู้ปกครอง are.
 *
 * Rows are held in the PARENT's state as a plain array and saved wholesale with
 * the rest of the form — this component owns no data of its own. It is also why
 * rows are keyed by index rather than by id: a freshly added row has no id yet,
 * and the server throws the ids away on every save (see replaceTeacherLists).
 * Nothing here reorders rows, so the index is stable for as long as a key needs
 * to be.
 *
 * `readOnly` renders the same rows without the inputs — the shape a teacher
 * sees for a list they may look at but not change.
 */
export function RepeatList<T>({
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
}: {
  title: string;
  hint?: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  /** A blank row — what "เพิ่ม" appends. */
  blank: () => T;
  /** The row's fields. `set` writes one field of THIS row. */
  renderRow: (row: T, set: (k: keyof T) => (v: string) => void) => React.ReactNode;
  /** One-line rendering of a row, used when readOnly. */
  renderSummary?: (row: T) => React.ReactNode;
  addLabel?: string;
  emptyLabel?: string;
  readOnly?: boolean;
}) {
  const update = (i: number) => (k: keyof T) => (v: string) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="card">
      <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: hint ? 2 : 0 }}>{title}</h2>
          {hint && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{hint}</p>}
        </div>
        <span className="badge badge-muted">{rows.length} รายการ</span>
      </div>

      {rows.length === 0 && (
        <p className="muted" style={{ fontSize: 13, margin: '12px 0 0' }}>{emptyLabel}</p>
      )}

      <div className="stack" style={{ gap: 12, marginTop: 12 }}>
        {rows.map((row, i) => (
          <div
            key={i}
            style={{
              border: '0.5px solid var(--skdw-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              background: 'var(--skdw-bg)',
            }}
          >
            <div className="row-between" style={{ marginBottom: readOnly ? 0 : 10 }}>
              <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                รายการที่ {i + 1}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => remove(i)}
                  aria-label={`ลบรายการที่ ${i + 1}`}
                >
                  <IconTrash width={14} height={14} /> ลบ
                </button>
              )}
            </div>
            {readOnly ? (
              <div style={{ fontSize: 14 }}>{renderSummary?.(row) ?? null}</div>
            ) : (
              <div className="grid-2" style={{ gap: 12 }}>{renderRow(row, update(i))}</div>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 12 }}
          onClick={() => onChange([...rows, blank()])}
        >
          + {addLabel}
        </button>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client';

interface Group {
  id: number;
  name: string;
}

/**
 * กลุ่มสาระ picker — a real `<select>` over the list managed in
 * /users/subject-groups, replacing the free-text box that produced a different
 * spelling every time somebody typed it.
 *
 * The one behaviour that matters on upgrade day: **a value the record already
 * carries is always an option, and always the selected one.** The 120-odd
 * teachers who were filed under hand-typed groups keep exactly the string they
 * had — opening one of them shows that string selected, and pressing บันทึก
 * without touching this field saves it back unchanged. The seeding in
 * src/lib/services/subject-groups.ts means this should never actually trigger
 * (every in-use name is in the table by then), but it is here so the answer
 * does not depend on the seed having run: a value can only ever be changed by
 * somebody deliberately choosing a different one.
 *
 * A value not in the list is labelled "(ค่าเดิม)" rather than hidden, so an
 * admin can see at a glance which people are still on an unlisted spelling.
 */
export function SubjectGroupSelect({
  label = 'กลุ่มสาระ',
  value,
  onChange,
  hint,
  disabled,
  style,
  /** Text of the "no group" option. */
  emptyLabel = '— ไม่ระบุ —',
}: {
  label?: string | null;
  value: string | null | undefined;
  onChange: (v: string) => void;
  hint?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  emptyLabel?: string;
}) {
  const { groups, loading, error } = useSubjectGroups();
  const current = value ?? '';

  // The legacy value goes at the END of the list, so it never looks like part
  // of the school's curated order.
  const legacy = current && !groups.some((g) => g.name === current) ? current : null;

  return (
    <div style={style}>
      {label && <label className="form-label">{label}</label>}
      <select
        className="form-select"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label ?? 'กลุ่มสาระ'}
      >
        <option value="">{emptyLabel}</option>
        {groups.map((g) => (
          <option key={g.id} value={g.name}>{g.name}</option>
        ))}
        {legacy && <option value={legacy}>{legacy} (ค่าเดิม)</option>}
      </select>
      {legacy && (
        <p className="form-hint" style={{ color: 'var(--color-warning)' }}>
          ค่าเดิมนี้ยังไม่มีในรายการกลุ่มสาระ — จะถูกเก็บไว้เหมือนเดิมจนกว่าจะเลือกใหม่
        </p>
      )}
      {error && <p className="form-hint" style={{ color: 'var(--color-error)' }}>{error}</p>}
      {hint && !legacy && !error && <p className="form-hint">{hint}</p>}
      {loading && !groups.length && <p className="form-hint">กำลังโหลดรายการกลุ่มสาระ…</p>}
    </div>
  );
}

/**
 * The same list as a filter `<select>` — "ทุกกลุ่มสาระ" plus every group. Kept
 * beside the field version so both read the same endpoint and a group added in
 * one place appears in the other without a second fetch path.
 */
export function SubjectGroupFilter({
  value,
  onChange,
  width = 260,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: number | string;
}) {
  const { groups } = useSubjectGroups();
  // A filter can legitimately be pointed at an unlisted value (arriving from a
  // link, or a group hidden after someone picked it), so keep it selectable.
  const extra = value && !groups.some((g) => g.name === value) ? value : null;

  return (
    <select
      className="form-select"
      style={{ width }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="กลุ่มสาระ"
    >
      <option value="">ทุกกลุ่มสาระ</option>
      {groups.map((g) => (
        <option key={g.id} value={g.name}>{g.name}</option>
      ))}
      {extra && <option value={extra}>{extra}</option>}
    </select>
  );
}

/**
 * Shared fetch. Every mounted picker gets the same in-flight promise, so a page
 * with a filter and a dialog open still makes one request; the cache is cleared
 * by `refreshSubjectGroups()` after the manage page writes.
 */
let cache: Promise<Group[]> | null = null;

function fetchGroups(): Promise<Group[]> {
  cache ??= api<{ data: Group[] }>('/api/users/subject-groups')
    .then((r) => r.data ?? [])
    .catch((e) => {
      cache = null; // a failure must not be remembered as "there are no groups"
      throw e;
    });
  return cache;
}

/** Call after creating/renaming/deleting a group so open pickers re-fetch. */
export function refreshSubjectGroups() {
  cache = null;
}

function useSubjectGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchGroups()
      .then((g) => { if (alive) { setGroups(g); setError(null); } })
      .catch((e: Error) => { if (alive) setError(`โหลดรายการกลุ่มสาระไม่สำเร็จ: ${e.message}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return useMemo(() => ({ groups, loading, error }), [groups, loading, error]);
}

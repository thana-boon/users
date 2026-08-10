'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  TH_MONTHS_FULL,
  TH_WEEKDAYS,
  daysInThaiMonth,
  firstWeekdayOfThaiMonth,
  thaiDateParts,
  toThaiDate,
} from '@/lib/thai';

/**
 * Buddhist-era month calendar.
 *
 * The native `<input type="date">` draws whatever calendar the *browser* is set
 * to, which on the school's machines is a Gregorian one — staff who think in
 * พ.ศ. were reading 2026 and doing the ±543 in their heads on every record. So
 * the picker is ours: the grid is laid out from พ.ศ. numbers directly, and the
 * year dropdown lists พ.ศ. Nothing else in the app changes — it hands back the
 * same "dd/mm/BBBB" string that is stored.
 *
 * Rendered into a portal at `position: fixed` for the same reason Combo's list
 * is: `.modal` sets `overflow-y: auto` and clips anything absolutely positioned
 * near the edge of a dialog.
 */
const WIDTH = 296;
/** Roughly the popup's own height — only used to decide whether to flip up. */
const HEIGHT = 328;

export function ThaiCalendar({
  anchorRef,
  value,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Current raw "dd/mm/BBBB", or '' — used only to seed the opening month. */
  value: string;
  onPick: (raw: string) => void;
  onClose: () => void;
}) {
  const selected = thaiDateParts(value);

  // Mount-time snapshot — a popup never outlives a day boundary in practice.
  const [today] = useState(() => {
    const n = new Date();
    return { day: n.getDate(), month: n.getMonth() + 1, yearBE: n.getFullYear() + 543 };
  });

  const [view, setView] = useState(() => ({
    month: selected?.month ?? today.month,
    yearBE: selected?.yearBE ?? today.yearBE,
  }));

  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    // Flip above the field when the month grid would hang off the bottom.
    const up = below < HEIGHT && r.top - 8 > below;
    setBox({
      left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // The popup is a portal, so "outside" has to name it explicitly — it is not a
  // DOM descendant of the field.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onClose]);

  // A century back covers staff birth dates; a few years ahead covers วันที่จบ
  // planned for next academic year. The stored year is always in the list, even
  // when a legacy row falls outside that window.
  const years = useMemo(() => {
    const from = Math.min(today.yearBE - 100, selected?.yearBE ?? today.yearBE);
    const to = Math.max(today.yearBE + 5, selected?.yearBE ?? today.yearBE);
    const out: number[] = [];
    for (let y = to; y >= from; y--) out.push(y);
    return out;
  }, [today.yearBE, selected?.yearBE]);

  function shiftMonth(step: number) {
    setView((v) => {
      const m = v.month + step;
      if (m < 1) return { month: 12, yearBE: v.yearBE - 1 };
      if (m > 12) return { month: 1, yearBE: v.yearBE + 1 };
      return { month: m, yearBE: v.yearBE };
    });
  }

  const lead = firstWeekdayOfThaiMonth(view.month, view.yearBE);
  const total = daysInThaiMonth(view.month, view.yearBE);
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  if (typeof document === 'undefined' || !box) return null;

  const navBtn: React.CSSProperties = {
    width: 28, height: 28, display: 'grid', placeItems: 'center',
    border: '1px solid var(--skdw-border)', borderRadius: 'var(--radius-sm)',
    background: '#fff', color: 'var(--skdw-dark)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
  };

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label="เลือกวันที่ (พ.ศ.)"
      style={{
        position: 'fixed',
        // Above .modal (--z-modal: 300), so a dialog never covers the calendar.
        zIndex: 350,
        left: box.left,
        ...(box.top !== undefined ? { top: box.top } : { bottom: box.bottom }),
        width: WIDTH, padding: 10, background: '#fff',
        border: '1px solid var(--skdw-border)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <button type="button" style={navBtn} aria-label="เดือนก่อนหน้า" onClick={() => shiftMonth(-1)}>‹</button>
        <select
          className="form-select"
          aria-label="เดือน"
          style={{ flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 'var(--text-md)' }}
          value={view.month}
          onChange={(e) => setView((v) => ({ ...v, month: Number(e.target.value) }))}
        >
          {TH_MONTHS_FULL.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </select>
        <select
          className="form-select"
          aria-label="ปี พ.ศ."
          style={{ width: 84, padding: '6px 8px', fontSize: 'var(--text-md)' }}
          value={view.yearBE}
          onChange={(e) => setView((v) => ({ ...v, yearBE: Number(e.target.value) }))}
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" style={navBtn} aria-label="เดือนถัดไป" onClick={() => shiftMonth(1)}>›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {TH_WEEKDAYS.map((w, i) => (
          <div
            key={w}
            style={{
              textAlign: 'center', fontSize: 11, padding: '4px 0',
              color: i === 0 ? '#b23c3c' : 'var(--skdw-muted)',
            }}
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`x${i}`} />;
          const isSel = selected?.day === d && selected.month === view.month && selected.yearBE === view.yearBE;
          const isToday = today.day === d && today.month === view.month && today.yearBE === view.yearBE;
          return (
            <button
              key={d}
              type="button"
              aria-label={`${d} ${TH_MONTHS_FULL[view.month - 1]} ${view.yearBE}`}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => { onPick(toThaiDate(d, view.month, view.yearBE)); onClose(); }}
              style={{
                height: 32, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                fontSize: 'var(--text-md)', fontWeight: isSel ? 600 : 400,
                background: isSel ? 'var(--skdw-purple)' : 'transparent',
                color: isSel ? '#fff' : i % 7 === 0 ? '#b23c3c' : 'var(--skdw-dark)',
                border: isToday && !isSel ? '1.5px solid var(--skdw-gold)' : '1.5px solid transparent',
              }}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="row" style={{ gap: 6, marginTop: 8, justifyContent: 'space-between' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => { onPick(toThaiDate(today.day, today.month, today.yearBE)); onClose(); }}
        >
          วันนี้
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onPick(''); onClose(); }}>
          ล้าง
        </button>
      </div>
    </div>,
    document.body,
  );
}

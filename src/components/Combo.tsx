'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeChoice } from '@/lib/options';

/**
 * Searchable single-value picker (combobox) for fields that have a short list of
 * expected answers but must still accept anything — ศาสนา / สัญชาติ / เชื้อชาติ /
 * เพศ / คำนำหน้า / ประเภท-เหตุผลการจำหน่าย.
 *
 * Typing filters the list and is also the value itself, so nothing is lost when
 * the answer is not on the list. On blur the text is run through
 * `normalizeChoice`, which snaps common misspellings ("พุทธิ") and synonyms
 * ("ศาสนาพุทธ", "มุสลิม") onto the canonical option. Pass `normalize={false}`
 * to keep the raw text.
 *
 * The list is rendered into a portal on `document.body` and positioned with
 * `position: fixed`, not absolutely inside the field. An absolute list is
 * clipped by any scrolling ancestor, and `.modal` sets `overflow-y: auto` — so
 * a combo near the bottom of a dialog (เหตุผล in the จำหน่าย/ลาออก dialog) had
 * its options cut off by the dialog's own edge. Fixed + portal escapes every
 * such clip; the trade is that the position must be re-measured whenever
 * anything scrolls or resizes.
 */
export function Combo({
  label,
  value,
  onChange,
  options,
  placeholder = 'เลือกหรือพิมพ์…',
  normalize = true,
  required = false,
  hint,
  style,
  inputStyle,
}: {
  label?: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  normalize?: boolean;
  required?: boolean;
  hint?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  // Only filter once the user actually types — opening the list should show
  // every option even when a value is already selected.
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(-1);
  // Viewport coordinates for the portalled list, re-measured on scroll/resize.
  // Also carries the room available below vs above, so the list flips upward
  // instead of running off the bottom of the window.
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const text = value ?? '';

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!typing || !q) return options;
    const hits = options.filter((o) => o.toLowerCase().includes(q));
    return hits.length ? hits : options;
  }, [options, text, typing]);

  const measure = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < 180 && above > below;
    setBox({
      left: r.left,
      width: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      maxHeight: Math.max(120, Math.min(220, up ? above : below)),
    });
  }, []);

  // Measure before paint so the list never flashes at the wrong spot, then keep
  // it pinned to the input while anything scrolls (capture: true also catches
  // the .modal's own scroll, which does not bubble).
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Close when the click lands outside the widget. The list lives in a portal,
  // so "outside" has to exclude it explicitly — it is not a DOM descendant.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function commit(v: string) {
    onChange(normalize ? (normalizeChoice(v, options) ?? '') : v.trim());
    setTyping(false);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + filtered.length) % Math.max(filtered.length, 1));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && filtered[active]) {
        e.preventDefault();
        commit(filtered[active]);
      } else {
        commit(text);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div style={style}>
      {label && <label className={`form-label${required ? ' required' : ''}`}>{label}</label>}
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <input
          className="form-input"
          style={{ paddingRight: 30, ...inputStyle }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={label}
          value={text}
          placeholder={placeholder}
          onChange={(e) => { onChange(e.target.value); setTyping(true); setOpen(true); setActive(-1); }}
          onFocus={() => { setOpen(true); setTyping(false); }}
          onBlur={() => { if (normalize && text.trim()) onChange(normalizeChoice(text, options) ?? ''); }}
          onKeyDown={onKeyDown}
        />
        <span
          aria-hidden
          onPointerDown={(e) => { e.preventDefault(); setOpen((o) => !o); setTyping(false); }}
          style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--skdw-muted)', fontSize: 10, cursor: 'pointer', lineHeight: 1,
          }}
        >
          ▼
        </span>

        {open && filtered.length > 0 && box && typeof document !== 'undefined' && createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={{
              position: 'fixed',
              // Above .modal (--z-modal: 300) so a dialog never covers the list.
              zIndex: 350,
              left: box.left, width: box.width,
              ...(box.top !== undefined ? { top: box.top } : { bottom: box.bottom }),
              maxHeight: box.maxHeight, overflowY: 'auto', background: '#fff',
              border: '1px solid var(--skdw-border)', borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-md, 0 8px 24px rgba(26,22,37,0.12))',
            }}
          >
            {filtered.map((o, i) => {
              const selected = o === text.trim();
              return (
                <div
                  key={o}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onPointerDown={(e) => { e.preventDefault(); commit(o); }}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', fontSize: 'var(--text-md)',
                    background: i === active ? 'var(--skdw-purple-pale)' : 'transparent',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {o}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
      </div>
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

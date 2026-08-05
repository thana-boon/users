'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  // Fields near the bottom of a scrolling .modal would push the list past the
  // modal's clipped edge — flip it above the input when there is no room below.
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const text = value ?? '';

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!typing || !q) return options;
    const hits = options.filter((o) => o.toLowerCase().includes(q));
    return hits.length ? hits : options;
  }, [options, text, typing]);

  useEffect(() => {
    if (!open) return;
    const box = wrapRef.current?.getBoundingClientRect();
    if (box) setDropUp(window.innerHeight - box.bottom < 240 && box.top > 240);
  }, [open]);

  // Close when the click lands outside the widget.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
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

        {open && filtered.length > 0 && (
          <div
            ref={listRef}
            role="listbox"
            style={{
              position: 'absolute', zIndex: 30, left: 0, right: 0,
              ...(dropUp ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
              maxHeight: 220, overflowY: 'auto', background: '#fff',
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
          </div>
        )}
      </div>
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

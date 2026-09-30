'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeChoice } from '@/lib/options';
import { IconCheck, IconChevron, IconSearch } from './Icons';

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
 *
 * On a touch screen the field opens {@link ComboSheet} instead — a bottom sheet
 * with its own search box and a list the thumb can scroll. The dropdown did not
 * survive a finger: an option picked on touch-DOWN meant a swipe to scroll the
 * list chose whatever it started on, and the list vanishing before the finger
 * lifted let the rest of the tap land on the field underneath, which focused
 * the NEXT combo and opened its list too. The sheet picks on a finished tap,
 * never touches the keyboard unless the search box is tapped, and hands focus
 * back to this field — not the next one — when it closes.
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
  error,
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
  /** Shown under the field, which is drawn red — e.g. a required field left blank. */
  error?: string;
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
  const coarse = useCoarsePointer();
  const [sheet, setSheet] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);
  // A list this long is searched, not scrolled: open it with the keyboard up.
  const searchFirst = options.length > SEARCH_FIRST_OVER;

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

  if (coarse) {
    return (
      <div style={style}>
        {label && <label className={`form-label${required ? ' required' : ''}`}>{label}</label>}
        <div style={{ position: 'relative' }}>
          <button
            ref={triggerRef}
            type="button"
            className={`form-input combo-trigger${error ? ' error' : ''}`}
            style={{ paddingRight: 40, ...inputStyle }}
            aria-haspopup="listbox"
            aria-expanded={sheet}
            aria-invalid={error ? true : undefined}
            aria-label={label ? `${label}: ${text || 'ยังไม่ได้เลือก'}` : undefined}
            onClick={() => {
              // iOS raises the keyboard only for a focus() made inside the tap
              // itself; the sheet's search box does not exist yet, so focus a
              // stand-in now and let the sheet move focus across once mounted —
              // the keyboard stays up through the hand-over.
              if (searchFirst) proxyRef.current?.focus({ preventScroll: true });
              setSheet(true);
            }}
          >
            {text ? <span className="combo-trigger-text">{text}</span> : <span className="combo-trigger-text muted">{placeholder}</span>}
          </button>
          <span aria-hidden className="combo-trigger-icon"><IconChevron width={16} height={16} /></span>
          {searchFirst && (
            <input ref={proxyRef} aria-hidden tabIndex={-1} className="combo-proxy" autoComplete="off" />
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        {hint && <p className="form-hint">{hint}</p>}
        {sheet && (
          <ComboSheet
            searchFirst={searchFirst}
            title={label ?? placeholder}
            value={text}
            options={options}
            onPick={(v) => onChange(normalize ? (normalizeChoice(v, options) ?? '') : v.trim())}
            onClose={() => {
              setSheet(false);
              // Back to THIS field (a button: no keyboard, no list) so the page
              // does not jump and nothing else opens.
              triggerRef.current?.focus({ preventScroll: true });
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={style}>
      {label && <label className={`form-label${required ? ' required' : ''}`}>{label}</label>}
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <input
          className={`form-input${error ? ' error' : ''}`}
          style={{ paddingRight: 40, ...inputStyle }}
          aria-invalid={error ? true : undefined}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={label}
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          onChange={(e) => { onChange(e.target.value); setTyping(true); setOpen(true); setActive(-1); }}
          onFocus={() => { setOpen(true); setTyping(false); }}
          onBlur={() => { if (normalize && text.trim()) onChange(normalizeChoice(text, options) ?? ''); }}
          onKeyDown={onKeyDown}
        />
        {/* A 40px-wide strip down the right edge, not a 10px glyph — on a phone
            this is where a thumb goes to open the list. */}
        <span
          aria-hidden
          onPointerDown={(e) => { e.preventDefault(); setOpen((o) => !o); setTyping(false); }}
          style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: 40,
            display: 'grid', placeItems: 'center',
            color: 'var(--skdw-muted)', cursor: 'pointer',
          }}
        >
          <IconChevron
            width={16}
            height={16}
            style={{ transition: 'transform var(--transition-fast)', transform: open ? 'rotate(180deg)' : undefined }}
          />
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
              maxHeight: box.maxHeight, overflowY: 'auto', overscrollBehavior: 'contain',
              background: 'var(--card)',
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
                  // Keep focus in the input; choose on the finished click, not
                  // on the press — a press that becomes a scroll must not pick.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(o)}
                  className="combo-opt"
                  style={{
                    cursor: 'pointer',
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
      {error && <p className="form-error">{error}</p>}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

/** Lists longer than this open with the search box focused (มหาวิทยาลัย, จังหวัด, วิชาเอก). */
const SEARCH_FIRST_OVER = 20;

/**
 * True on a finger-first device (phone, tablet). Read after mount, so the
 * server render and the first client render agree on the desktop field.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return coarse;
}

/**
 * The phone picker: a bottom sheet with a search box on top and the options
 * below, each a full-width 48px row.
 *
 * - A row is chosen on click, which the browser only fires for a tap — a swipe
 *   scrolls the list and chooses nothing.
 * - The search box is NOT focused on open, so the keyboard stays down and the
 *   whole list is in view; tapping it brings the keyboard for a long list
 *   (มหาวิทยาลัย). While the keyboard is up the sheet sits on top of it,
 *   measured from `visualViewport`, since iOS does not shrink the layout
 *   viewport and a plain `bottom: 0` would slide under the keys.
 * - Anything typed that is not on the list is offered as its own row, so a
 *   free-text answer is still one tap.
 */
function ComboSheet({
  searchFirst = false,
  title,
  value,
  options,
  onPick,
  onClose,
}: {
  searchFirst?: boolean;
  title: string;
  value: string;
  options: readonly string[];
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [kb, setKb] = useState({ bottom: 0, height: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const current = value.trim();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? options.filter((o) => o.toLowerCase().includes(needle)) : [...options];
    // A saved answer that is not one of the options still shows, ticked, on top.
    if (!needle && current && !options.includes(current)) list.unshift(current);
    return list;
  }, [options, q, current]);
  const typed = q.trim();
  const offerTyped = typed !== '' && !shown.some((o) => o.toLowerCase() === typed.toLowerCase());

  // Sit on top of the on-screen keyboard, and never taller than what is left.
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const sync = () => {
      if (!vv) return setKb({ bottom: 0, height: window.innerHeight });
      setKb({
        bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
        height: vv.height,
      });
    };
    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
    };
  }, []);

  // The page behind must not scroll while the sheet is up.
  useEffect(() => {
    const html = document.documentElement;
    const prev = [html.style.overflow, document.body.style.overflow];
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      html.style.overflow = prev[0];
      document.body.style.overflow = prev[1];
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Open with the current answer in view rather than at the top of a long list,
  // or — for a list meant to be searched — with the search box taking the
  // keyboard over from the stand-in the trigger focused.
  useLayoutEffect(() => {
    if (searchFirst) searchRef.current?.focus({ preventScroll: true });
    else listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [searchFirst]);

  // Pull the sheet down by its handle/header to close it, as on any phone sheet.
  const onTouchStart = (e: React.TouchEvent) => { drag.current = { y: e.touches[0].clientY, dy: 0 }; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current || !panelRef.current) return;
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    drag.current.dy = dy;
    panelRef.current.style.transition = 'none';
    panelRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onTouchEnd = () => {
    const el = panelRef.current;
    const dy = drag.current?.dy ?? 0;
    drag.current = null;
    if (!el) return;
    if (dy > 80) { onClose(); return; }
    el.style.transition = 'transform 0.2s ease-out';
    el.style.transform = '';
  };

  function pick(v: string) {
    onPick(v);
    onClose();
  }

  return createPortal(
    <div className="combo-sheet-scrim" onClick={onClose}>
      <div
        ref={panelRef}
        className="combo-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ bottom: kb.bottom, maxHeight: Math.max(240, Math.min(kb.height - 24, kb.height * 0.85)) }}
      >
        <div className="combo-sheet-drag" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div className="combo-sheet-grip" aria-hidden />
        <div className="combo-sheet-head">
          <div className="combo-sheet-title">{title}</div>
          {current && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => pick('')}>ล้างค่า</button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>ปิด</button>
        </div>
        </div>
        <div className="combo-sheet-search">
          <IconSearch width={18} height={18} aria-hidden />
          <input
            ref={searchRef}
            className="form-input"
            type="search"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="ค้นหา หรือพิมพ์เอง"
            aria-label={`ค้นหา${title}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (offerTyped) pick(typed);
              else if (shown.length === 1) pick(shown[0]);
              else (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
        <div ref={listRef} className="combo-sheet-list" role="listbox" aria-label={title}>
          {shown.map((o) => {
            const selected = o === current;
            return (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={selected}
                className={`combo-sheet-opt${selected ? ' is-selected' : ''}`}
                onClick={() => pick(o)}
              >
                <span>{o}</span>
                {selected && <IconCheck width={18} height={18} />}
              </button>
            );
          })}
          {/* After the matches, so a list answer is always the first thing offered. */}
          {offerTyped && (
            <button type="button" role="option" aria-selected={false} className="combo-sheet-opt" onClick={() => pick(typed)}>
              <span>ใช้ “<strong>{typed}</strong>”</span>
            </button>
          )}
          {shown.length === 0 && !offerTyped && (
            <p className="muted" style={{ padding: '16px', margin: 0, fontSize: 14 }}>ไม่พบรายการ</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

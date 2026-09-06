'use client';

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * The way back to the SchoolOS portal, for the screens with no sidebar to put a
 * link in: a phone browser, and an installed PWA of any size (which has no
 * address bar to type into either). A laptop running this app in a normal
 * browser tab already has the app's own navigation on screen, so the stylesheet
 * below hides the button there — and on paper.
 *
 * Where the user drags it is remembered as an ANCHOR (which corner, how far
 * from it) rather than an {x, y}. A phone at 390px and an iPad at 834px
 * disagree about what x=340 means, but "16px in from the right edge" survives a
 * rotation, a resize and a different device.
 */

// Same default as every service's SCHOOLOS_PORTAL_URL, so the two agree without
// anyone having to rebuild. NEXT_PUBLIC_SCHOOLOS_HOME overrides it at BUILD
// time (Next inlines NEXT_PUBLIC_* into the client bundle).
const SCHOOLOS_HOME_URL =
  process.env.NEXT_PUBLIC_SCHOOLOS_HOME || 'https://schoolos.sukhon.ac.th/';

const STORAGE_KEY = 'schoolos-fab-anchor';
const SIZE = 64; // px — keep in step with the width in CSS below
const MARGIN = 16; // px — closest the button may sit to an edge
const BOTTOM_INSET = 60; // px — clears the bottom bar these apps carry on phones
const DRAG_THRESHOLD = 4; // px — past this a press counts as a drag, not a tap

interface Point {
  x: number;
  y: number;
}

interface Anchor {
  h: 'left' | 'right';
  v: 'top' | 'bottom';
  dx: number; // distance from the chosen left/right edge
  dy: number; // distance from the chosen top/bottom edge
}

const DEFAULT_ANCHOR: Anchor = {
  h: 'right',
  v: 'bottom',
  dx: MARGIN,
  dy: MARGIN + BOTTOM_INSET,
};

/**
 * Looks and visibility live in CSS, not in JS: no first paint at the wrong
 * size, and no matchMedia listener to keep in sync with a breakpoint.
 *
 * The desktop rule is written as hide-then-unhide rather than a single
 * `(display-mode: browser)` query, because a browser that has never heard of
 * display-mode throws the whole query away — and the fallback worth having in
 * that case is "hidden on a wide screen", not "shown everywhere".
 */
const CSS = `
.skdw-back-fab {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 64px;
  padding: 10px 6px;
  border-radius: 16px;
  background: #5b2d8e;
  color: #fff;
  box-shadow: 0 10px 15px -3px rgba(91, 45, 142, 0.35);
  text-decoration: none;
  opacity: 0.7;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.skdw-back-fab:active { transform: scale(0.95); }
.skdw-back-fab[data-dragging='true'] { opacity: 1; transition: none; }
.skdw-back-fab-label {
  font-size: 9px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: 0.02em;
  text-align: center;
}
@media print {
  .skdw-back-fab { display: none !important; }
}
@media (min-width: 1024px) {
  .skdw-back-fab { display: none; }
}
@media (min-width: 1024px) and (display-mode: standalone) {
  .skdw-back-fab { display: flex; }
}
@media (min-width: 1024px) and (display-mode: fullscreen) {
  .skdw-back-fab { display: flex; }
}
@media (min-width: 1024px) and (display-mode: minimal-ui) {
  .skdw-back-fab { display: flex; }
}
@media (min-width: 1024px) {
  /* iOS got display-mode late; an iPad on the Home Screen says so through
     navigator.standalone instead. */
  .skdw-back-fab[data-standalone='true'] { display: flex; }
}
`;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveAnchor(a: Anchor): Point {
  const maxX = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
  return {
    x: clamp(a.h === 'left' ? a.dx : window.innerWidth - SIZE - a.dx, MARGIN, maxX),
    y: clamp(a.v === 'top' ? a.dy : window.innerHeight - SIZE - a.dy, MARGIN, maxY),
  };
}

/** Nearest corner wins, so a button let go mid-screen settles against an edge. */
function toAnchor(pos: Point): Anchor {
  const h = pos.x + SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right';
  const v = pos.y + SIZE / 2 < window.innerHeight / 2 ? 'top' : 'bottom';
  return {
    h,
    v,
    dx: Math.max(0, h === 'left' ? pos.x : window.innerWidth - SIZE - pos.x),
    dy: Math.max(0, v === 'top' ? pos.y : window.innerHeight - SIZE - pos.y),
  };
}

function readStoredAnchor(): Anchor {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_ANCHOR;
    const parsed = JSON.parse(stored) as Partial<Anchor>;
    if (
      (parsed.h !== 'left' && parsed.h !== 'right') ||
      (parsed.v !== 'top' && parsed.v !== 'bottom') ||
      !Number.isFinite(parsed.dx) ||
      !Number.isFinite(parsed.dy)
    ) {
      return DEFAULT_ANCHOR;
    }
    return { h: parsed.h, v: parsed.v, dx: parsed.dx as number, dy: parsed.dy as number };
  } catch {
    // Private mode, or site data blocked: the button still works, it just
    // forgets where it was put.
    return DEFAULT_ANCHOR;
  }
}

export function BackToSchoolOS() {
  const [pos, setPos] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [iosStandalone, setIosStandalone] = useState(false);
  const anchorRef = useRef<Anchor>(DEFAULT_ANCHOR);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragged: boolean;
  } | null>(null);

  useEffect(() => {
    // window / localStorage do not exist during SSR, hence an effect rather
    // than a lazy useState initialiser.
    anchorRef.current = readStoredAnchor();
    setPos(resolveAnchor(anchorRef.current));
    setIosStandalone(
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
  }, []);

  useEffect(() => {
    // Re-resolve from the anchor rather than clamping the old pixels: a rotated
    // iPad that was only clamped would end up pinned to the wrong edge.
    function handleResize() {
      setPos((prev) => (prev ? resolveAnchor(anchorRef.current) : prev));
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  function handlePointerDown(e: ReactPointerEvent<HTMLAnchorElement>) {
    if (!pos) return;
    // Capture keeps pointermove coming even when the finger outruns the button.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      dragged: false,
    };
    setDragging(true);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLAnchorElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) drag.dragged = true;
    setPos({
      x: clamp(drag.originX + dx, MARGIN, Math.max(MARGIN, window.innerWidth - SIZE - MARGIN)),
      y: clamp(drag.originY + dy, MARGIN, Math.max(MARGIN, window.innerHeight - SIZE - MARGIN)),
    });
  }

  function handlePointerUp() {
    if (!dragRef.current) return;
    setDragging(false);
    setPos((current) => {
      if (!current) return current;
      const anchor = toAnchor(current);
      anchorRef.current = anchor;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(anchor));
      } catch {
        // As above: no storage, no memory, still a working button.
      }
      return resolveAnchor(anchor);
    });
    // Cleared one tick late, because the click that follows pointerup still has
    // to be able to see whether this gesture was a drag.
    setTimeout(() => {
      dragRef.current = null;
    }, 0);
  }

  function handleClick(e: ReactMouseEvent<HTMLAnchorElement>) {
    if (dragRef.current?.dragged) e.preventDefault();
  }

  if (!pos) return null;

  return (
    <>
      <style>{CSS}</style>
      <a
        className="skdw-back-fab"
        href={SCHOOLOS_HOME_URL}
        target="_self"
        aria-label="กลับไปหน้าแรก SchoolOS"
        draggable={false}
        data-dragging={dragging ? 'true' : 'false'}
        data-standalone={iosStandalone ? 'true' : 'false'}
        style={{ left: pos.x, top: pos.y }}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9 21v-6h6v6" />
        </svg>
        <span className="skdw-back-fab-label">Back to SchoolOS</span>
      </a>
    </>
  );
}

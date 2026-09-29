'use client';

import { useEffect, useRef } from 'react';

/**
 * "ยังไม่ได้บันทึก" — warn before leaving a page with edits nobody saved.
 *
 * Any number of components can hold unsaved work at once (the page's own form,
 * a วุฒิ row open for editing), so each registers itself here and the guard is
 * up while ANY of them is dirty. Two ways out are covered:
 *
 *  - closing the tab, reloading, or a full navigation (ออกจากระบบ sets
 *    location.href) — the browser's own beforeunload prompt; its wording is the
 *    browser's, not ours.
 *  - clicking a link inside the app — a Next <Link> navigates client-side and
 *    never fires beforeunload, so link clicks are caught in the capture phase,
 *    ahead of React's handler, and asked about first.
 *
 * The browser's back button is not covered: the App Router has no hook to
 * cancel a popstate, and faking one is worse than the gap.
 */

export const UNSAVED_MESSAGE = 'ยังไม่ได้บันทึกข้อมูลที่แก้ไข — ออกจากหน้านี้เลยหรือไม่? ข้อมูลที่แก้จะหายไป';

const dirty = new Set<symbol>();

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.size) return;
  e.preventDefault();
  // Still required by some browsers for the prompt to appear at all.
  e.returnValue = '';
}

function onClick(e: MouseEvent) {
  if (!dirty.size || e.defaultPrevented || e.button !== 0) return;
  // Modifier clicks open a new tab — this page, and its edits, stay put.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const to = new URL(a.href, location.href);
  // A same-page #anchor is not leaving.
  if (to.pathname === location.pathname && to.search === location.search) return;
  if (!window.confirm(UNSAVED_MESSAGE)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function sync() {
  if (dirty.size) {
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
  } else {
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('click', onClick, true);
  }
}

/** Keep the leave-page warning up for as long as `isDirty` is true. */
export function useUnsavedChanges(isDirty: boolean) {
  const id = useRef<symbol>(null);
  if (!id.current) id.current = Symbol('unsaved');
  useEffect(() => {
    if (!isDirty) return;
    const me = id.current!;
    dirty.add(me);
    sync();
    return () => {
      dirty.delete(me);
      sync();
    };
  }, [isDirty]);
}

/**
 * The same values, ignoring the difference between '', null and a missing key —
 * a field someone typed into and cleared again is not an edit.
 */
export function sameValues(a: unknown, b: unknown): boolean {
  const canon = (v: unknown) =>
    JSON.stringify(v, (_k, x) => (x === '' || x === null ? undefined : x));
  return canon(a) === canon(b);
}

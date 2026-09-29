'use client';

import { useEffect, useRef } from 'react';
import { useConfirm, type ConfirmOptions } from '@/components/Confirm';

/**
 * "ยังไม่ได้บันทึก" — warn before leaving a page with edits nobody saved.
 *
 * Any number of components can hold unsaved work at once (the page's own form,
 * a วุฒิ row open for editing), so each registers itself here and the guard is
 * up while ANY of them is dirty. The question is asked in the app's own modal
 * (Confirm), never window.confirm:
 *
 *  - clicking a link — caught in the capture phase, ahead of React's handler
 *    (a Next <Link> navigates client-side and never fires beforeunload). The
 *    click is held, the modal asked, and on "ออกเลย" the same link is clicked
 *    again with the guard dropped.
 *  - ออกจากระบบ and the like — {@link confirmLeave} before navigating.
 *
 * Closing the tab or reloading still gets the BROWSER's prompt: that is the
 * only thing a page may show at that moment — no page script can put its own
 * dialog there. The browser's back button is not covered: the App Router has
 * no hook to cancel a popstate.
 */

const dirty = new Set<symbol>();
let ask: ((o: ConfirmOptions) => Promise<boolean>) | null = null;

const LEAVE: ConfirmOptions = {
  title: 'ยังไม่ได้บันทึกข้อมูล',
  message: 'ข้อมูลที่แก้ไขในหน้านี้ยังไม่ได้บันทึก\nถ้าออกจากหน้านี้ ข้อมูลที่แก้จะหายไป',
  confirmText: 'ออกโดยไม่บันทึก',
  cancelText: 'อยู่ต่อเพื่อบันทึก',
  danger: true,
};

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

  e.preventDefault();
  e.stopPropagation();
  void confirmLeave().then((go) => {
    // The guard is down now, so this click goes straight through — to the
    // Next router for a <Link>, to the browser for a plain <a>.
    if (go) a.click();
  });
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

/**
 * Ask before leaving, if anything is unsaved. True = go ahead, and the guard is
 * dropped so the navigation that follows is not asked about a second time.
 */
export async function confirmLeave(): Promise<boolean> {
  if (!dirty.size) return true;
  const go = ask ? await ask(LEAVE) : true;
  if (go) discardUnsaved();
  return go;
}

/** Drop the guard without asking — for leaving that is not a choice (session expired). */
export function discardUnsaved() {
  dirty.clear();
  sync();
}

/** Keep the leave-page warning up for as long as `isDirty` is true. */
export function useUnsavedChanges(isDirty: boolean) {
  const confirm = useConfirm();
  const id = useRef<symbol>(null);
  if (!id.current) id.current = Symbol('unsaved');
  useEffect(() => {
    ask = confirm;
  }, [confirm]);
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

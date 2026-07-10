'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * App-wide confirmation dialog — a modal replacement for the native
 * window.confirm(). Use like:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm('ลบรายการนี้?'))) return;
 *   // or, with options:
 *   if (!(await confirm({ title: 'ย้อนกลับ', message: '…', confirmText: 'ย้อนกลับ', danger: true }))) return;
 *
 * Returns a promise that resolves true (confirmed) / false (cancelled).
 * Multi-line messages (\n) render as separate lines.
 */
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(async () => false);

export function useConfirm() {
  return useContext(ConfirmCtx);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(typeof o === 'string' ? { message: o } : o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((v: boolean) => {
    setOpts(null);
    resolver.current?.(v);
    resolver.current = null;
  }, []);

  // Esc cancels, Enter confirms while the dialog is open.
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts, close]);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="modal-scrim"
          role="dialog"
          aria-modal="true"
          aria-label={opts.title ?? 'ยืนยัน'}
          onClick={() => close(false)}
        >
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="card-header">{opts.title ?? 'ยืนยันการทำรายการ'}</div>
            <div className="card-pad stack" style={{ gap: 18 }}>
              <div style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>{opts.message}</div>
              <div className="row-between">
                <button className="btn btn-ghost btn-sm" onClick={() => close(false)} autoFocus>
                  {opts.cancelText ?? 'ยกเลิก'}
                </button>
                <button
                  className={`btn btn-sm ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
                  onClick={() => close(true)}
                >
                  {opts.confirmText ?? 'ยืนยัน'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

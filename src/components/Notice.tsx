'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { IconAlert, IconCheck } from './Icons';

/**
 * The modal that says "saved".
 *
 * A toast in the corner is easy to miss — it fades in four seconds, and on a
 * long edit page the eye is on the form, not the corner. A save that quietly
 * appears to do nothing gets pressed again, so the outcome of บันทึก is stated
 * in the middle of the screen and waits to be acknowledged.
 *
 *   const notice = useNotice();
 *   notice('บันทึกข้อมูลเรียบร้อยแล้ว');
 *   notice({ kind: 'error', message: err.message });
 *
 * Returns a promise that resolves when it is dismissed. Callers that have
 * nothing to do afterwards can ignore it. Kept apart from useConfirm(): that
 * one asks a question, this one reports an outcome, and giving a report a
 * ยกเลิก button is how someone ends up thinking the save was undone.
 */
export interface NoticeOptions {
  kind?: 'success' | 'error';
  title?: string;
  message: string;
  /** A second, quieter line — e.g. what was left untouched. */
  detail?: string;
  okText?: string;
}

type NoticeFn = (opts: NoticeOptions | string) => Promise<void>;

const NoticeCtx = createContext<NoticeFn>(async () => {});

export function useNotice() {
  return useContext(NoticeCtx);
}

export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<NoticeOptions | null>(null);
  const resolver = useRef<(() => void) | null>(null);

  const notice = useCallback<NoticeFn>((o) => {
    setOpts(typeof o === 'string' ? { message: o } : o);
    return new Promise<void>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback(() => {
    setOpts(null);
    resolver.current?.();
    resolver.current = null;
  }, []);

  // Esc and Enter both dismiss — there is only one way out of a report.
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts, close]);

  const error = opts?.kind === 'error';

  return (
    <NoticeCtx.Provider value={notice}>
      {children}
      {opts && (
        <div
          className="modal-scrim"
          role="dialog"
          aria-modal="true"
          aria-label={opts.title ?? (error ? 'บันทึกไม่สำเร็จ' : 'บันทึกแล้ว')}
          onClick={close}
        >
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="card-pad stack" style={{ gap: 16, alignItems: 'center', textAlign: 'center' }}>
              <span
                aria-hidden
                style={{
                  width: 56, height: 56, borderRadius: '50%',
                  display: 'grid', placeItems: 'center',
                  background: error ? 'var(--color-error-bg)' : 'var(--color-success-bg)',
                  color: error ? 'var(--color-error)' : 'var(--color-success)',
                }}
              >
                {error ? <IconAlert width={28} height={28} /> : <IconCheck width={30} height={30} />}
              </span>
              <div className="stack" style={{ gap: 6 }}>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
                  {opts.title ?? (error ? 'บันทึกไม่สำเร็จ' : 'บันทึกเรียบร้อยแล้ว')}
                </div>
                <div style={{ whiteSpace: 'pre-line', lineHeight: 1.7 }}>{opts.message}</div>
                {opts.detail && (
                  <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>{opts.detail}</div>
                )}
              </div>
              <button
                className={`btn ${error ? 'btn-secondary' : 'btn-primary'}`}
                style={{ minWidth: 140 }}
                onClick={close}
                autoFocus
              >
                {opts.okText ?? 'ตกลง'}
              </button>
            </div>
          </div>
        </div>
      )}
    </NoticeCtx.Provider>
  );
}

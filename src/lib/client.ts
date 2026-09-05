'use client';

/**
 * Build-time base path (next.config.mjs BASE_PATH). This app does NOT use Next's
 * own `basePath`, so nothing is prefixed automatically — the split is by what is
 * being addressed, not by which API does the addressing:
 *
 *   PAGE routes      /users/login, /users/students — already live under /users
 *                    in src/app. Use them AS-IS (Link, router.push, redirect,
 *                    window.location). Prefixing one asks for /users/users/…
 *   API / assets /   /api/*, /mediapipe/*, /icon.png — live at the root, and the
 *   public files     gateway delivers them prefixed. These need withBase(), and
 *                    next.config's beforeFiles rewrites strip it again on the
 *                    way in.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** Prefix a root-relative API/asset path ('/api/...') with the app's base path. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** Small typed fetch wrapper. Cookies ride along automatically (same origin). */
export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(withBase(path), {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data && (data.error as string)) || `เกิดข้อผิดพลาด (${res.status})`;
    const err = new Error(msg) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

/**
 * Is this page running as an installed app rather than in a browser tab?
 *
 * What the login form sends as `client` so the server knows which session
 * windows to use (see SessionClient in lib/jwt.ts). `display-mode: standalone`
 * is what a manifest with `"display": "standalone"` produces once the app has
 * been added to the home screen; iOS Safari answers the same question through
 * `navigator.standalone`, which it has had since long before the media query.
 *
 * A guess by nature — a tab is a tab and cannot be told apart with certainty —
 * which is why the answer only ever buys a longer session, never a wider one.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches === true ||
    iosStandalone === true
  );
}

/** The `client` field the auth endpoints take. See isStandalone(). */
export function sessionClient(): 'web' | 'pwa' {
  return isStandalone() ? 'pwa' : 'web';
}

export function jsonBody(v: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(v) };
}

'use client';

/**
 * Build-time base path (next.config.mjs BASE_PATH). Next auto-prefixes
 * Link/router.push/redirect(), but NOT raw fetch(), <a href>, <img src> or
 * window.location — those must go through withBase()/api().
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** Prefix a root-relative path ('/api/...') with the app's base path. */
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

export function jsonBody(v: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(v) };
}

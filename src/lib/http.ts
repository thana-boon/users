import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function notFound(message = 'ไม่พบข้อมูลที่ค้นหา') {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** The request was fine, the server just cannot do it right now (e.g. busy). */
export function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

export function serverError(message = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง') {
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Wrap a handler so EVERY response it returns carries `Cache-Control: no-store`.
 *
 * For the endpoints whose entire answer is "who is this browser, right now" —
 * the SSO probe and the handoff mint. That answer stops being true the instant
 * someone signs out and the next person signs in, so anything between here and
 * the browser that keeps a copy — the gateway, the browser's own store — would
 * hand the new user the old user's identity. That is the stale-session bug the
 * consumer services had, moved one layer further out and much harder to see.
 *
 * Next already treats these routes as dynamic and answers no-store of its own
 * accord today. Saying it out loud costs a header and stops the guarantee from
 * resting on a framework default, or on every consumer service remembering
 * `cache: 'no-store'` at its end. Same reasoning as the logout route, which has
 * always set it by hand.
 */
export function withNoStore(
  handler: (req: NextRequest) => Promise<NextResponse>,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req) => {
    const res = await handler(req);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };
}

/** Wrap a handler body: turns ZodError into 400, anything else into 500. */
export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return badRequest('ข้อมูลไม่ถูกต้อง', err.flatten());
  }
  console.error('[api] unhandled error', err);
  return serverError();
}

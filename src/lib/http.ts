import { NextResponse } from 'next/server';
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

export function serverError(message = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง') {
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Wrap a handler body: turns ZodError into 400, anything else into 500. */
export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return badRequest('ข้อมูลไม่ถูกต้อง', err.flatten());
  }
  console.error('[api] unhandled error', err);
  return serverError();
}

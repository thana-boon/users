import { NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/jwt';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res.cookies);
  return res;
}

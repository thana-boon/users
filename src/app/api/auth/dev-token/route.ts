import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { signSession, SESSION_COOKIE, type AppRole } from '@/lib/jwt';
import { badRequest, handleError } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * DEV-ONLY mock token minter. Stands in for real SSO. Generates a JWT and
 * drops it in an httpOnly cookie so the browser is "logged in". Disable in any
 * deployed env by setting ENABLE_DEV_TOKEN=false (checked below).
 *
 * POST /api/auth/dev-token  { role?, sub?, name?, code? }
 */

const bodySchema = z.object({
  role: z.enum(['student', 'teacher', 'teacher-admin']).default('teacher-admin'),
  sub: z.string().default('0'),
  name: z.string().optional(),
  code: z.string().optional(),
});

function devEnabled(): boolean {
  return (process.env.ENABLE_DEV_TOKEN ?? 'false').toLowerCase() === 'true';
}

export async function POST(req: NextRequest) {
  try {
    if (!devEnabled()) {
      return badRequest('dev-token ถูกปิดในสภาพแวดล้อมนี้ (ENABLE_DEV_TOKEN=false)');
    }
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const role = body.role as AppRole;
    const token = await signSession({
      sub: body.sub,
      role,
      name: body.name ?? (role === 'teacher-admin' ? 'Dev Admin' : 'Dev User'),
      code: body.code,
    });

    const res = NextResponse.json({ token, role, sub: body.sub });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}

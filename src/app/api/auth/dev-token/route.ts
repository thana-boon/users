import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  signSession,
  SESSION_COOKIE,
  USERS_READ,
  USERS_WRITE,
} from '@/lib/jwt';
import { badRequest, handleError } from '@/lib/http';

export const runtime = 'nodejs';

/**
 * DEV-ONLY mock token minter. Stands in for the real SSO portal: it signs a
 * token with the exact same contract (role + permissions + login_at) and drops
 * it in the `schoolos_token` cookie so the browser is "logged in". Disable in
 * any deployed env by setting ENABLE_DEV_TOKEN=false (checked below).
 *
 * POST /api/auth/dev-token  { role?, permissions?, sub?, name?, code? }
 * With no body it mints a full admin token (users:read + users:write).
 */

const bodySchema = z.object({
  role: z.enum(['teacher', 'student']).default('teacher'),
  // When omitted, an admin token is minted so the module is reachable in dev.
  permissions: z.array(z.string()).optional(),
  sub: z.string().default('DEV'),
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
    const permissions =
      body.permissions ??
      (body.role === 'teacher' ? [USERS_READ, USERS_WRITE] : []);
    const token = await signSession({
      sub: body.sub,
      role: body.role,
      name: body.name ?? (body.role === 'teacher' ? 'Dev Admin' : 'Dev User'),
      code: body.code ?? body.sub,
      permissions,
    });

    const res = NextResponse.json({ token, role: body.role, sub: body.sub, permissions });
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

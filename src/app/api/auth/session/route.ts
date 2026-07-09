import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ session: null }, { status: 200 });
  return NextResponse.json({
    session: {
      sub: session.sub,
      role: session.role,
      name: session.name ?? null,
      code: session.code ?? null,
      permissions: session.permissions,
    },
  });
}

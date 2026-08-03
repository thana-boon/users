import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { getSession } from '@/lib/auth';
import {
  hasPermission,
  idleTimeoutMs,
  sessionExpiresAt,
  USERS_WRITE,
  type SessionClaims,
} from '@/lib/jwt';
import { platformHomeUrl } from '@/lib/platform';
import { AppShell } from '@/components/AppShell';
import { SessionGuard } from '@/components/SessionGuard';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/Confirm';

export const dynamic = 'force-dynamic';

/**
 * Who is signed in, for the header avatar.
 *
 * The token carries a name but no row id, so the photo needs one lookup — a
 * unique-index hit on teacher_code. Only teachers are looked up: local student
 * login issues an empty permission list, so nobody else can be past the guard
 * above.
 *
 * Failures are swallowed. The avatar is decoration; a database hiccup should
 * not turn the whole module into an error page over it.
 */
async function avatarOf(session: SessionClaims): Promise<{ photoUrl: string | null; initial: string }> {
  const fromToken = (session.name ?? '').trim().slice(0, 1);
  if (session.role !== 'teacher') return { photoUrl: null, initial: fromToken };

  try {
    const [me] = await db
      .select({
        id: teachers.id,
        firstName: teachers.firstName,
        // Never select the base64 itself — it is megabytes, on every page load.
        hasPhoto: sql<boolean>`${teachers.photoBase64} is not null`,
      })
      .from(teachers)
      .where(eq(teachers.teacherCode, session.sub))
      .limit(1);
    if (!me) return { photoUrl: null, initial: fromToken };
    return {
      photoUrl: me.hasPhoto ? `/api/users/teachers/${me.id}/photo` : null,
      initial: me.firstName.trim().slice(0, 1) || fromToken,
    };
  } catch {
    return { photoUrl: null, initial: fromToken };
  }
}

export default async function UsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware already gates this, but re-check for defence in depth. Same split
  // it makes: no session goes out to the portal, a session without the
  // permission gets the login page, which can actually explain itself.
  const session = await getSession();
  if (!session) redirect(platformHomeUrl({ next: '/users' }));
  if (!hasPermission(session, USERS_WRITE)) {
    redirect('/users/login?next=/users&denied=1');
  }

  const { photoUrl, initial } = await avatarOf(session);

  return (
    <ToastProvider>
      <ConfirmProvider>
        {/* Seeded from the server so the countdown is right on first paint,
            before any cookie has been read. */}
        <SessionGuard
          expiresAt={sessionExpiresAt(session)}
          expiredUrl={platformHomeUrl({ expired: '1' })}
          idleMs={idleTimeoutMs()}
        />
        <AppShell
          session={{ name: session.name ?? null, role: session.role, photoUrl, initial }}
          signedOutUrl={platformHomeUrl()}
        >
          {children}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
}

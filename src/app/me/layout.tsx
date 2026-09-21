import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { students, teachers } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { hasPermission, idleTimeoutMs, sessionExpiresAt, USERS_WRITE } from '@/lib/jwt';
import { platformHomeUrl } from '@/lib/platform';
import { MeShell } from '@/components/MeShell';
import { SessionGuard } from '@/components/SessionGuard';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/Confirm';

export const dynamic = 'force-dynamic';

/**
 * "ข้อมูลของฉัน" — served at /users/me (see the rewrite in next.config.mjs),
 * and living OUTSIDE src/app/users on purpose: that segment's layout redirects
 * anyone without `users:write` away, which is precisely the audience here.
 *
 * One page for both kinds of account. Middleware has already established that
 * someone is signed in; the check is repeated here for defence in depth,
 * exactly as the admin layout repeats its own.
 */
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect(platformHomeUrl({ next: '/users/me' }));
  if (session.role !== 'teacher' && session.role !== 'student') redirect(platformHomeUrl());

  // Name and photo for the header. Failures are swallowed: the header is
  // decoration, and the page below fetches the record it actually edits.
  let hasPhoto = false;
  let firstName = '';
  try {
    if (session.role === 'teacher') {
      const [me] = await db
        .select({
          firstName: teachers.firstName,
          // Never select the base64 itself — it is megabytes, on every page load.
          hasPhoto: sql<boolean>`${teachers.photoBase64} is not null`,
        })
        .from(teachers)
        .where(eq(teachers.teacherCode, session.sub))
        .limit(1);
      hasPhoto = me?.hasPhoto ?? false;
      firstName = me?.firstName ?? '';
    } else {
      const [me] = await db
        .select({
          firstName: students.firstName,
          hasPhoto: sql<boolean>`${students.photoBase64} is not null`,
        })
        .from(students)
        .where(eq(students.studentCode, session.sub))
        .limit(1);
      hasPhoto = me?.hasPhoto ?? false;
      firstName = me?.firstName ?? '';
    }
  } catch {
    /* header only */
  }

  const name = session.name ?? session.sub;

  return (
    <ToastProvider>
      <ConfirmProvider>
        <SessionGuard
          expiresAt={sessionExpiresAt(session)}
          expiredUrl={platformHomeUrl({ expired: '1' })}
          idleMs={idleTimeoutMs(session)}
        />
        <MeShell
          name={name}
          initial={(firstName || name).trim().slice(0, 1)}
          hasPhoto={hasPhoto}
          // The mode switch is for admins only — a plain teacher or a student
          // has no other mode to be in, so the button is simply absent.
          isAdmin={hasPermission(session, USERS_WRITE)}
          signedOutUrl={platformHomeUrl()}
        >
          {children}
        </MeShell>
      </ConfirmProvider>
    </ToastProvider>
  );
}

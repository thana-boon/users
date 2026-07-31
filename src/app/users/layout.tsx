import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { hasPermission, USERS_WRITE, type SessionClaims } from '@/lib/jwt';
import { AppShell } from '@/components/AppShell';
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
  // Middleware already gates this, but re-check for defence in depth.
  const session = await getSession();
  if (!session || !hasPermission(session, USERS_WRITE)) {
    redirect('/users/login?next=/users');
  }

  const { photoUrl, initial } = await avatarOf(session);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppShell session={{ name: session.name ?? null, role: session.role, photoUrl, initial }}>
          {children}
        </AppShell>
      </ConfirmProvider>
    </ToastProvider>
  );
}

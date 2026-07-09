import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { hasPermission, USERS_WRITE } from '@/lib/jwt';
import { AppShell } from '@/components/AppShell';
import { ToastProvider } from '@/components/Toast';

export const dynamic = 'force-dynamic';

export default async function UsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware already gates this, but re-check for defence in depth.
  const session = await getSession();
  if (!session || !hasPermission(session, USERS_WRITE)) {
    redirect('/login?next=/users');
  }

  return (
    <ToastProvider>
      <AppShell session={{ name: session.name ?? null, role: session.role }}>
        {children}
      </AppShell>
    </ToastProvider>
  );
}

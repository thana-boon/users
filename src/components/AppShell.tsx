'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  IconDashboard,
  IconStudents,
  IconTeachers,
  IconCalendar,
  IconAudit,
  IconLogout,
  IconShield,
} from './Icons';

interface SessionInfo {
  name: string | null;
  role: string;
}

const NAV = [
  { href: '/users', label: 'ภาพรวม', Icon: IconDashboard, exact: true },
  { href: '/users/students', label: 'นักเรียน', Icon: IconStudents },
  { href: '/users/teachers', label: 'ครู', Icon: IconTeachers },
  { href: '/users/academic-years', label: 'ปีการศึกษา', Icon: IconCalendar },
  { href: '/users/audit', label: 'บันทึกการใช้งาน', Icon: IconAudit },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

export function AppShell({
  session,
  children,
}: {
  session: SessionInfo;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* Navbar */}
      <header
        style={{
          height: 64,
          background: 'var(--skdw-purple)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--space-6)',
          boxShadow: 'var(--shadow-md)',
          position: 'sticky',
          top: 0,
          zIndex: 200,
        }}
      >
        <div className="row" style={{ gap: 12 }}>
          <div
            aria-hidden
            style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'var(--skdw-gold)', color: 'var(--skdw-dark)',
              display: 'grid', placeItems: 'center', fontWeight: 800,
              fontFamily: 'var(--font-en)',
            }}
          >
            S
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontWeight: 700 }}>SchoolOS</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>ข้อมูลนักเรียนและครู</div>
          </div>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 12 }}>
          <span
            className="badge badge-gold"
            title="สิทธิ์เข้าถึงเฉพาะผู้มีสิทธิ์ users:write"
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <IconShield width={13} height={13} /> ผู้ดูแล
          </span>
          <span style={{ fontSize: 13, opacity: 0.9 }} className="hide-mobile">
            {session.name ?? 'ผู้ดูแลระบบ'}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={logout} style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>
            <IconLogout width={16} height={16} /> <span className="hide-mobile">ออกจากระบบ</span>
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar (desktop) */}
        <nav className="sidebar-desktop" aria-label="เมนูหลัก">
          {NAV.map(({ href, label, Icon, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                className="side-item"
                aria-current={active ? 'page' : undefined}
                data-active={active}
              >
                <Icon width={20} height={20} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Main */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            padding: 'var(--space-8)',
            paddingBottom: 88,
          }}
        >
          {children}
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="bottom-nav" aria-label="เมนูหลัก (มือถือ)">
        {NAV.map(({ href, label, Icon, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <Link key={href} href={href} className="bottom-item" data-active={active} aria-current={active ? 'page' : undefined}>
              <Icon width={22} height={22} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <style>{`
        .sidebar-desktop {
          width: 240px; background: #fff; border-right: 0.5px solid var(--skdw-border);
          padding: var(--space-4) var(--space-3); display: flex; flex-direction: column; gap: 4px;
          position: sticky; top: 64px; height: calc(100dvh - 64px); overflow-y: auto;
        }
        .side-item {
          display: flex; align-items: center; gap: var(--space-3); padding: 10px 14px;
          border-radius: var(--radius-sm); font-size: var(--text-md); color: var(--skdw-dark);
          transition: background var(--transition-fast);
        }
        .side-item:hover { background: var(--skdw-bg); }
        .side-item[data-active="true"] { background: var(--skdw-purple-pale); color: var(--skdw-purple); font-weight: 600; }
        .bottom-nav { display: none; }
        @media (max-width: 900px) {
          .sidebar-desktop { display: none; }
          .hide-mobile { display: none; }
          .bottom-nav {
            display: flex; position: fixed; bottom: 0; left: 0; right: 0; height: 64px;
            background: #fff; border-top: 0.5px solid var(--skdw-border); z-index: 200;
            padding-bottom: env(safe-area-inset-bottom);
          }
          .bottom-item {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 2px; font-size: 10px; color: var(--skdw-muted);
          }
          .bottom-item[data-active="true"] { color: var(--skdw-purple); font-weight: 600; }
        }
      `}</style>
    </div>
  );
}

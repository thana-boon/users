'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { withBase } from '@/lib/client';
import {
  IconDashboard,
  IconStudents,
  IconTeachers,
  IconCalendar,
  IconAudit,
  IconLogout,
  IconShield,
  IconPromote,
  IconHash,
  IconGraduate,
  IconPause,
  IconExit,
  IconEnroll,
  IconChevron,
  IconTrash,
  IconWorker,
  IconHistory,
  IconKey,
  IconHomeroom,
  IconDatabase,
  IconSpecialTeacher,
  IconSubjectGroup,
} from './Icons';

interface SessionInfo {
  name: string | null;
  role: string;
  /** Photo endpoint for the signed-in user, or null when they have no photo. */
  photoUrl: string | null;
  /** First character of their ชื่อจริง — the fallback when there is no photo. */
  initial: string;
}

/**
 * The signed-in user in the navbar: their photo, or the first letter of their
 * first name on the same gold tile as the SchoolOS mark, so the header reads as
 * one thing whether or not a photo exists.
 *
 * `onError` matters because `photoUrl` is resolved when the layout renders, and
 * the layout does NOT re-render on client-side navigation — deleting your own
 * photo would otherwise leave a broken image in the corner until a full reload.
 */
function Avatar({ photoUrl, initial, name }: { photoUrl: string | null; initial: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = photoUrl !== null && !failed;

  return (
    <div
      title={name}
      style={{
        width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        background: 'var(--skdw-gold)', color: 'var(--skdw-dark)',
        display: 'grid', placeItems: 'center',
        fontWeight: 700, fontSize: 15, lineHeight: 1,
        border: '1.5px solid rgba(255,255,255,0.55)',
      }}
    >
      {showPhoto ? (
        <img
          src={withBase(photoUrl)}
          alt={name}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span aria-hidden>{initial || '?'}</span>
      )}
    </div>
  );
}

/**
 * The signed-in user as a menu: the photo (or initial) is the button, and
 * ออกจากระบบ lives inside it — which is where people look for it, and it keeps
 * a destructive action one deliberate click away instead of sitting exposed in
 * the navbar next to the nav items.
 *
 * The whole thing is one `<button>` so keyboard and screen-reader users get the
 * same affordance; the menu closes on click-away and on Escape.
 */
function UserMenu({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = session.name ?? 'ผู้ดูแลระบบ';

  useEffect(() => {
    if (!open) return;
    // mousedown, not click: a click on a menu item would otherwise be raced by
    // the close handler and the item would never fire.
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="user-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`บัญชีผู้ใช้ — ${name}`}
      >
        <Avatar photoUrl={session.photoUrl} initial={session.initial} name={name} />
        {/* The avatar stays on mobile — it is the one thing that still says
            who is signed in once the name is hidden. */}
        <span style={{ fontSize: 13, opacity: 0.9 }} className="hide-mobile">{name}</span>
        <IconChevron width={14} height={14} className="user-btn-chevron" data-open={open} />
      </button>

      {open && (
        <div className="user-menu" role="menu">
          <div className="user-menu-head">
            <div style={{ fontWeight: 600 }}>{name}</div>
            <div className="muted mono" style={{ fontSize: 11 }}>{session.role}</div>
          </div>
          <button type="button" role="menuitem" className="user-menu-item" onClick={onLogout}>
            <IconLogout width={16} height={16} /> ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  );
}

type Leaf = { href: string; label: string; Icon: typeof IconDashboard; exact?: boolean };
type Group = { label: string; Icon: typeof IconDashboard; children: Leaf[] };
type NavNode = Leaf | Group;

const isGroup = (n: NavNode): n is Group => 'children' in n;

const NAV: NavNode[] = [
  { href: '/users', label: 'ภาพรวม', Icon: IconDashboard, exact: true },
  {
    label: 'นักเรียน',
    Icon: IconStudents,
    children: [
      { href: '/users/students', label: 'ทะเบียนนักเรียน', Icon: IconStudents },
      { href: '/users/placements', label: 'จัดเข้าห้อง', Icon: IconEnroll },
      { href: '/users/promotions', label: 'เลื่อนชั้น', Icon: IconPromote },
      { href: '/users/class-numbers', label: 'จัดเลขที่', Icon: IconHash },
      { href: '/users/graduations', label: 'จบการศึกษา', Icon: IconGraduate },
      { href: '/users/leaves', label: 'พักการเรียน', Icon: IconPause },
      { href: '/users/withdrawals', label: 'จำหน่าย/ลาออก', Icon: IconExit },
      { href: '/users/former-students', label: 'นักเรียนเก่า', Icon: IconHistory },
    ],
  },
  {
    label: 'บุคลากร',
    Icon: IconTeachers,
    children: [
      { href: '/users/teachers', label: 'ครู', Icon: IconTeachers },
      { href: '/users/homerooms', label: 'ครูประจำชั้น', Icon: IconHomeroom },
      { href: '/users/special-teachers', label: 'อาจารย์พิเศษ', Icon: IconSpecialTeacher },
      { href: '/users/workers', label: 'คนงาน', Icon: IconWorker },
      { href: '/users/subject-groups', label: 'กลุ่มสาระ', Icon: IconSubjectGroup },
    ],
  },
  { href: '/users/academic-years', label: 'ปีการศึกษา', Icon: IconCalendar },
  { href: '/users/archive', label: 'ถังขยะ', Icon: IconTrash },
  { href: '/users/api-manager', label: 'API Manager', Icon: IconKey },
  { href: '/users/backups', label: 'สำรอง/กู้คืนข้อมูล', Icon: IconDatabase },
  { href: '/users/audit', label: 'บันทึกการใช้งาน', Icon: IconAudit },
];

// Flat list of every leaf (for the mobile bottom nav — the group collapses to
// its first child there so the bar stays compact).
const MOBILE_NAV: Leaf[] = NAV.map((n) =>
  isGroup(n) ? { ...n.children[0], label: n.label, Icon: n.Icon } : n,
);

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

function groupActive(pathname: string, g: Group) {
  return g.children.some((c) => isActive(pathname, c.href, c.exact));
}

export function AppShell({
  session,
  signedOutUrl,
  children,
}: {
  session: SessionInfo;
  /** Where signing out lands — the platform portal. Built server-side in the
   *  layout, because lib/platform reads an env var a client bundle cannot see. */
  signedOutUrl: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  async function logout() {
    await fetch(withBase('/api/auth/logout'), { method: 'POST' });
    // A full navigation, not router.push(): the portal is its own origin in dev
    // and the Next router cannot leave the app. It also guarantees every page
    // rendered behind the session that just died is thrown away.
    window.location.href = signedOutUrl;
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
          <UserMenu session={session} onLogout={logout} />
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar (desktop) */}
        <nav className="sidebar-desktop" aria-label="เมนูหลัก">
          {NAV.map((node) =>
            isGroup(node) ? (
              <NavGroup key={node.label} group={node} pathname={pathname} />
            ) : (
              <Link
                key={node.href}
                href={node.href}
                className="side-item"
                aria-current={isActive(pathname, node.href, node.exact) ? 'page' : undefined}
                data-active={isActive(pathname, node.href, node.exact)}
              >
                <node.Icon width={20} height={20} />
                <span>{node.label}</span>
              </Link>
            ),
          )}
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
        {MOBILE_NAV.map(({ href, label, Icon, exact }) => {
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
        .side-group-btn {
          display: flex; align-items: center; gap: var(--space-3); padding: 10px 14px; width: 100%;
          border: none; background: none; cursor: pointer; text-align: left;
          border-radius: var(--radius-sm); font-size: var(--text-md); color: var(--skdw-dark);
          font-family: inherit; transition: background var(--transition-fast);
        }
        .side-group-btn:hover { background: var(--skdw-bg); }
        .side-group-btn[data-active="true"] { color: var(--skdw-purple); font-weight: 600; }
        .side-group-chevron { margin-left: auto; transition: transform var(--transition-fast); }
        .side-group-chevron[data-open="false"] { transform: rotate(-90deg); }
        .side-subitem {
          display: flex; align-items: center; gap: var(--space-3); padding: 8px 14px 8px 40px;
          border-radius: var(--radius-sm); font-size: var(--text-md); color: var(--skdw-muted);
          transition: background var(--transition-fast);
        }
        .side-subitem:hover { background: var(--skdw-bg); }
        .side-subitem[data-active="true"] { background: var(--skdw-purple-pale); color: var(--skdw-purple); font-weight: 600; }
        .user-btn {
          display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 4px;
          border: 1px solid transparent; border-radius: 999px; cursor: pointer;
          background: none; color: inherit; font-family: inherit; font-size: inherit;
          transition: background var(--transition-fast), border-color var(--transition-fast);
        }
        .user-btn:hover, .user-btn[aria-expanded="true"] {
          background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.35);
        }
        .user-btn-chevron { transition: transform var(--transition-fast); opacity: 0.85; }
        .user-btn-chevron[data-open="false"] { transform: rotate(-90deg); }
        .user-menu {
          position: absolute; top: calc(100% + 8px); right: 0; min-width: 208px;
          background: #fff; color: var(--skdw-dark); border: 0.5px solid var(--skdw-border);
          border-radius: var(--radius-md); box-shadow: var(--shadow-md);
          padding: 6px; z-index: 300;
        }
        .user-menu-head {
          padding: 8px 10px 10px; border-bottom: 0.5px solid var(--skdw-border);
          margin-bottom: 6px; line-height: 1.35;
        }
        .user-menu-item {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 9px 10px; border: none; background: none; cursor: pointer;
          text-align: left; border-radius: var(--radius-sm);
          font-family: inherit; font-size: var(--text-md); color: var(--color-error);
          transition: background var(--transition-fast);
        }
        .user-menu-item:hover { background: var(--color-error-bg); }
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

function NavGroup({ group, pathname }: { group: Group; pathname: string }) {
  const active = groupActive(pathname, group);
  const [open, setOpen] = useState(active);

  // Auto-expand when navigating into one of the group's pages.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  return (
    <div>
      <button
        type="button"
        className="side-group-btn"
        data-active={active}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <group.Icon width={20} height={20} />
        <span>{group.label}</span>
        <IconChevron width={16} height={16} className="side-group-chevron" data-open={open} />
      </button>
      {open &&
        group.children.map((c) => {
          const a = isActive(pathname, c.href, c.exact);
          return (
            <Link
              key={c.href}
              href={c.href}
              className="side-subitem"
              aria-current={a ? 'page' : undefined}
              data-active={a}
            >
              <c.Icon width={16} height={16} />
              <span>{c.label}</span>
            </Link>
          );
        })}
    </div>
  );
}

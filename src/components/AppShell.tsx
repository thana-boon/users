'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { withBase } from '@/lib/client';
import { confirmLeave } from '@/lib/useUnsavedChanges';
import { allows, isAdminPerms } from '@/lib/permissions';
import { AccessProvider } from './Access';
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
  IconSettings,
  IconMore,
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

/** The hue a page's icon wears in every menu — one of the --tone-* tokens. */
type Tone =
  | 'purple' | 'indigo' | 'blue' | 'sky' | 'cyan' | 'teal' | 'green' | 'lime'
  | 'amber' | 'orange' | 'red' | 'rose' | 'pink' | 'fuchsia' | 'slate';
type Leaf = { href: string; label: string; Icon: typeof IconDashboard; tone: Tone; exact?: boolean };
type Group = { label: string; Icon: typeof IconDashboard; tone: Tone; children: Leaf[] };

const toneStyle = (tone: Tone) => ({ '--tone': `var(--tone-${tone})` }) as CSSProperties;

/** A menu icon on a tile of its page's hue. */
function NavIcon({ Icon, tone, size = 18, small }: { Icon: typeof IconDashboard; tone: Tone; size?: number; small?: boolean }) {
  return (
    <span className={small ? 'ico-tile ico-tile-sm nav-ico' : 'ico-tile nav-ico'} style={toneStyle(tone)}>
      <Icon width={size} height={size} />
    </span>
  );
}
type NavNode = Leaf | Group;

const isGroup = (n: NavNode): n is Group => 'children' in n;

/** Most a phone's bottom bar holds before the rest moves into เพิ่มเติม. */
const MAX_BAR = 5;

const NAV: NavNode[] = [
  { href: '/users', label: 'ภาพรวม', Icon: IconDashboard, tone: 'indigo', exact: true },
  {
    label: 'นักเรียน',
    Icon: IconStudents,
    tone: 'blue',
    children: [
      { href: '/users/students', label: 'ทะเบียนนักเรียน', Icon: IconStudents, tone: 'blue' },
      { href: '/users/placements', label: 'จัดเข้าห้อง', Icon: IconEnroll, tone: 'teal' },
      { href: '/users/promotions', label: 'เลื่อนชั้น', Icon: IconPromote, tone: 'green' },
      { href: '/users/class-numbers', label: 'จัดเลขที่', Icon: IconHash, tone: 'sky' },
      { href: '/users/graduations', label: 'จบการศึกษา', Icon: IconGraduate, tone: 'amber' },
      { href: '/users/leaves', label: 'พักการเรียน', Icon: IconPause, tone: 'orange' },
      { href: '/users/withdrawals', label: 'จำหน่าย/ลาออก', Icon: IconExit, tone: 'rose' },
      { href: '/users/former-students', label: 'นักเรียนเก่า', Icon: IconHistory, tone: 'slate' },
    ],
  },
  {
    label: 'บุคลากร',
    Icon: IconTeachers,
    tone: 'purple',
    children: [
      { href: '/users/teachers', label: 'ครู', Icon: IconTeachers, tone: 'purple' },
      { href: '/users/homerooms', label: 'ครูประจำชั้น', Icon: IconHomeroom, tone: 'fuchsia' },
      { href: '/users/special-teachers', label: 'อาจารย์พิเศษ', Icon: IconSpecialTeacher, tone: 'pink' },
      { href: '/users/workers', label: 'คนงาน', Icon: IconWorker, tone: 'orange' },
      { href: '/users/subject-groups', label: 'กลุ่มสาระ', Icon: IconSubjectGroup, tone: 'teal' },
    ],
  },
  { href: '/users/academic-years', label: 'ปีการศึกษา', Icon: IconCalendar, tone: 'cyan' },
  { href: '/users/archive', label: 'ถังขยะ', Icon: IconTrash, tone: 'red' },
  { href: '/users/settings', label: 'ตั้งค่าระบบ', Icon: IconSettings, tone: 'slate' },
  { href: '/users/permissions', label: 'จัดการสิทธิ์', Icon: IconShield, tone: 'green' },
  { href: '/users/api-manager', label: 'API Manager', Icon: IconKey, tone: 'amber' },
  { href: '/users/backups', label: 'สำรอง/กู้คืนข้อมูล', Icon: IconDatabase, tone: 'sky' },
  { href: '/users/audit', label: 'บันทึกการใช้งาน', Icon: IconAudit, tone: 'indigo' },
];

// Flat list of every leaf (for the mobile bottom nav — the group collapses to
// its first child there so the bar stays compact).
const MOBILE_NAV: Leaf[] = NAV.map((n) =>
  isGroup(n) ? { ...n.children[0], label: n.label, Icon: n.Icon, tone: n.tone } : n,
);

// A moderator sees only the pages their grants open (same rule table as
// middleware); a group left with no pages disappears. Middleware is what
// actually keeps them out — this only stops the menu offering pages that bounce.
function navFor(perms: readonly string[]): NavNode[] {
  return NAV.flatMap((n): NavNode[] => {
    if (!isGroup(n)) return allows(perms, n.href) ? [n] : [];
    const children = n.children.filter((c) => allows(perms, c.href));
    return children.length ? [{ ...n, children }] : [];
  });
}

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

function groupActive(pathname: string, g: Group) {
  return g.children.some((c) => isActive(pathname, c.href, c.exact));
}

export function AppShell({
  session,
  perms,
  signedOutUrl,
  children,
}: {
  session: SessionInfo;
  /** The session's permissions — decides the menu (and, via AccessProvider,
   *  which buttons pages show). */
  perms: readonly string[];
  /** Where signing out lands — the platform portal. Built server-side in the
   *  layout, because lib/platform reads an env var a client bundle cannot see. */
  signedOutUrl: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = isAdminPerms(perms);
  const nav: NavNode[] = isAdmin ? NAV : navFor(perms);
  const mobileNav: Leaf[] = isAdmin
    ? MOBILE_NAV
    : nav.map((n) => (isGroup(n) ? { ...n.children[0], label: n.label, Icon: n.Icon, tone: n.tone } : n));

  async function logout() {
    // Asked BEFORE the session is killed — staying must still leave a way to save.
    if (!(await confirmLeave())) return;
    await fetch(withBase('/api/auth/logout'), { method: 'POST' });
    // A full navigation, not router.push(): the portal is its own origin in dev
    // and the Next router cannot leave the app. It also guarantees every page
    // rendered behind the session that just died is thrown away.
    window.location.href = signedOutUrl;
  }

  // A bottom bar holds five at most (Material) — past that each item is a
  // sliver with 10px text. Four destinations and a เพิ่มเติม that opens the
  // whole menu, groups and all, so no page is out of reach on a phone.
  const barItems = mobileNav.length > MAX_BAR ? mobileNav.slice(0, MAX_BAR - 1) : mobileNav;
  const hasMore = mobileNav.length > MAX_BAR;
  const inBar = barItems.some((l) => isActive(pathname, l.href, l.exact));
  const [moreOpen, setMoreOpen] = useState(false);
  // Any navigation closes the sheet.
  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <a href="#app-main" className="skip-link">ข้ามไปยังเนื้อหา</a>
      {/* Navbar */}
      <header className="app-header">
        <div className="row" style={{ gap: 12 }}>
          <div
            aria-hidden
            style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'linear-gradient(135deg, #ffe066, var(--skdw-gold) 55%, var(--skdw-gold-dark))',
              color: 'var(--skdw-dark)', boxShadow: '0 3px 10px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.6)',
              display: 'grid', placeItems: 'center', fontWeight: 800,
              fontFamily: 'var(--font-en)',
            }}
          >
            S
          </div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontWeight: 700 }}>SchoolOS</div>
            <div style={{ fontSize: 12, opacity: 0.85 }} className="hide-mobile">ข้อมูลนักเรียนและครู</div>
          </div>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          {/* The other half of the mode switch (/users/me has the way back).
              Everyone who can see this shell is staff (admin or moderator), so it
              is always offered: they are teachers too, with a record of their
              own. Out in the header rather than inside the user menu, where
              nobody found it. A plain <a>, not <Link>: /users/me is served by a
              rewrite onto a different root layout (src/app/me), so switching
              mode is a real page load rather than a client-side navigation
              inside this shell. */}
          <a href="/users/me" className="mode-btn" title="ไปหน้าข้อมูลของฉัน เพื่อแก้ไขข้อมูลตนเองแบบครูทั่วไป">
            <IconTeachers width={14} height={14} />
            <span className="hide-mobile">สลับเป็นโหมดครู</span>
            <span className="only-mobile">โหมดครู</span>
          </a>
          <span
            className="badge badge-gold hide-mobile"
            title={isAdmin ? 'สิทธิ์ผู้ดูแลระบบ (users:write)' : 'สิทธิ์เฉพาะส่วนที่ได้รับมอบหมาย'}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <IconShield width={13} height={13} /> {isAdmin ? 'ผู้ดูแล' : 'Moderator'}
          </span>
          <UserMenu session={session} onLogout={logout} />
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar (desktop) */}
        <nav className="sidebar-desktop" aria-label="เมนูหลัก">
          {nav.map((node) =>
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
                <NavIcon Icon={node.Icon} tone={node.tone} />
                <span>{node.label}</span>
              </Link>
            ),
          )}
        </nav>

        {/* Main */}
        <main id="app-main" tabIndex={-1} className="app-main">
          <AccessProvider perms={perms}>{children}</AccessProvider>
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="bottom-nav" aria-label="เมนูหลัก (มือถือ)">
        {barItems.map(({ href, label, Icon, tone, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <Link key={href} href={href} className="bottom-item" data-active={active} aria-current={active ? 'page' : undefined}>
              <NavIcon Icon={Icon} tone={tone} size={19} />
              <span>{label}</span>
            </Link>
          );
        })}
        {hasMore && (
          <button
            type="button"
            className="bottom-item"
            data-active={!inBar}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <NavIcon Icon={IconMore} tone="slate" size={19} />
            <span>เพิ่มเติม</span>
          </button>
        )}
      </nav>

      {moreOpen && <MoreSheet nav={nav} pathname={pathname} onClose={() => setMoreOpen(false)} />}

      <style>{`
        .app-header {
          height: 64px; background: var(--grad-brand); color: #fff;
          display: flex; align-items: center; padding: 0 var(--space-6);
          border-bottom: 3px solid var(--skdw-gold);
          box-shadow: 0 6px 20px rgba(91, 45, 142, 0.28); position: sticky; top: 0; z-index: var(--z-sticky);
        }
        /* Pale gold on the purple bar is unreadable — the header's badge is solid. */
        .app-header .badge-gold { background: var(--skdw-gold); color: var(--skdw-dark); border-color: rgba(255, 255, 255, 0.5); }
        .app-main { flex: 1; min-width: 0; padding: var(--space-8); padding-bottom: 88px; }
        .app-main:focus { outline: none; }
        .sidebar-desktop {
          width: 240px; background: linear-gradient(180deg, #fff 0%, #fbf8ff 100%);
          border-right: 1px solid var(--skdw-border); box-shadow: 2px 0 12px rgba(91, 45, 142, 0.05);
          padding: var(--space-4) var(--space-3); display: flex; flex-direction: column; gap: 4px;
          position: sticky; top: 67px; height: calc(100dvh - 67px); overflow-y: auto;
        }
        .side-item {
          display: flex; align-items: center; gap: var(--space-3); padding: 6px 10px;
          border-radius: var(--radius-sm); font-size: var(--text-md); color: var(--skdw-dark);
          transition: background var(--transition-fast);
        }
        .side-item:hover, .side-group-btn:hover, .side-subitem:hover { background: var(--skdw-purple-pale); }
        .side-item[data-active="true"], .side-subitem[data-active="true"] {
          background: linear-gradient(90deg, var(--skdw-purple-pale), rgba(241, 237, 247, 0.4));
          color: var(--skdw-purple); font-weight: 600;
          box-shadow: inset 0 0 0 1px rgba(91, 45, 142, 0.14);
        }
        /* The current page's tile fills with its own hue. */
        [data-active="true"] > .nav-ico {
          background: var(--tone); color: #fff;
          box-shadow: 0 3px 10px color-mix(in srgb, var(--tone) 40%, transparent);
        }
        .side-group-btn {
          display: flex; align-items: center; gap: var(--space-3); padding: 6px 10px; width: 100%;
          border: none; background: none; cursor: pointer; text-align: left;
          border-radius: var(--radius-sm); font-size: var(--text-md); color: var(--skdw-dark);
          font-family: inherit; transition: background var(--transition-fast);
        }
        .side-group-btn[data-active="true"] { color: var(--skdw-purple); font-weight: 600; }
        .side-group-chevron { margin-left: auto; transition: transform var(--transition-fast); }
        .side-group-chevron[data-open="false"] { transform: rotate(-90deg); }
        .side-subitem {
          display: flex; align-items: center; gap: var(--space-3); padding: 5px 10px 5px 26px;
          border-radius: var(--radius-sm); font-size: var(--text-md); color: var(--skdw-muted);
          transition: background var(--transition-fast);
        }
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
          background: #fff; color: var(--skdw-dark); border: 1px solid var(--skdw-border);
          border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
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
        /* Same pill as MeShell's สลับเป็นโหมดผู้ดูแล, so the two halves of the
           switch look like one control. */
        .mode-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          min-height: 36px; padding: 6px 12px; border-radius: 999px; cursor: pointer;
          background: rgba(255,255,255,0.12); color: #fff;
          border: 1px solid rgba(255,255,255,0.35);
          font-family: inherit; font-size: 13px; line-height: 1.2;
          transition: background var(--transition-fast);
        }
        .mode-btn:hover { background: rgba(255,255,255,0.24); }
        .mode-btn:focus-visible, .user-btn:focus-visible { outline-color: var(--skdw-gold); }
        .only-mobile { display: none; }
        .bottom-nav { display: none; }
        @media (pointer: coarse) {
          .mode-btn, .user-btn { min-height: 44px; }
          .side-item, .side-group-btn, .side-subitem, .user-menu-item { min-height: 44px; }
        }
        @media (max-width: 900px) {
          .sidebar-desktop { display: none; }
          .hide-mobile { display: none; }
          .only-mobile { display: inline; }
          .app-header { height: 56px; padding: 0 var(--space-3) 0 var(--space-4); }
          .app-main { padding: var(--space-4) var(--space-3); padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
          .bottom-nav {
            display: flex; position: fixed; bottom: 0; left: 0; right: 0;
            height: calc(64px + env(safe-area-inset-bottom));
            background: var(--card); border-top: 1px solid var(--skdw-border); z-index: var(--z-sticky);
            box-shadow: 0 -4px 18px rgba(91, 45, 142, 0.1);
            padding-bottom: env(safe-area-inset-bottom);
          }
          .bottom-item {
            flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 3px; font-size: 12px; line-height: 1.2; color: var(--skdw-muted);
            border: none; background: none; font-family: inherit; padding: 0 2px;
          }
          .bottom-item span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .bottom-item[data-active="true"] { color: var(--skdw-purple); font-weight: 600; }
          .bottom-item:active { background: var(--skdw-purple-pale); }
          .bottom-item .nav-ico { width: 38px; height: 28px; border-radius: 999px; }
        }
        .more-sheet-list { display: flex; flex-direction: column; gap: 2px; padding: 0 var(--space-2) var(--space-4); }
        .more-sheet-group {
          padding: 12px 14px 4px; font-size: var(--text-xs); font-weight: 600;
          color: var(--skdw-muted); letter-spacing: 0.02em;
        }
        .more-sheet-list .side-item, .more-sheet-list .side-subitem { min-height: 48px; }
        .more-sheet-list .side-subitem { padding-left: 10px; color: var(--skdw-dark); }
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
        <NavIcon Icon={group.Icon} tone={group.tone} />
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
              <NavIcon Icon={c.Icon} tone={c.tone} size={15} small />
              <span>{c.label}</span>
            </Link>
          );
        })}
    </div>
  );
}

/**
 * The whole menu for a phone — every page the sidebar offers, groups spelled
 * out, as a bottom sheet over the page. Esc, the scrim and ปิด all close it.
 */
function MoreSheet({
  nav,
  pathname,
  onClose,
}: {
  nav: NavNode[];
  pathname: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The page underneath should not scroll along with the sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const leaf = (l: Leaf, sub: boolean) => {
    const a = isActive(pathname, l.href, l.exact);
    return (
      <Link
        key={l.href}
        href={l.href}
        className={sub ? 'side-subitem' : 'side-item'}
        aria-current={a ? 'page' : undefined}
        data-active={a}
        onClick={onClose}
      >
        <NavIcon Icon={l.Icon} tone={l.tone} small={sub} size={sub ? 15 : 18} />
        <span>{l.label}</span>
      </Link>
    );
  };

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="เมนูทั้งหมด" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-header row-between" style={{ position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
          <span>เมนูทั้งหมด</span>
          <button ref={closeRef} type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ปิด
          </button>
        </div>
        <nav className="more-sheet-list" aria-label="เมนูทั้งหมด">
          {nav.map((n) =>
            isGroup(n) ? (
              <div key={n.label}>
                <div className="more-sheet-group">{n.label}</div>
                {n.children.map((c) => leaf(c, true))}
              </div>
            ) : (
              leaf(n, false)
            ),
          )}
        </nav>
      </div>
    </div>
  );
}

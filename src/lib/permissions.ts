/**
 * Permission strings this module gates on.
 *
 * Their own file, with no imports, so a Client Component can name a permission
 * without dragging lib/jwt.ts — and with it `jose` and JWT_SECRET — into the
 * browser bundle. lib/jwt.ts re-exports both, so server code can keep importing
 * them from there. Middleware (edge) imports the path helpers below for the
 * same reason.
 */

/** Read access to this (admin-only) Records module. */
export const USERS_READ = 'users:read';
/** Write access — what middleware actually requires to enter the module. */
export const USERS_WRITE = 'users:write';
/**
 * Student records only — the `moderator` role. Enough to run the นักเรียน
 * group of pages (registry, placements, promotions, numbering, exits, leaves,
 * former students) and the APIs behind them, and nothing else: no staff, no
 * years, no settings, no keys, no backups, no audit log, no trash.
 */
export const USERS_STUDENTS = 'users:students';

/** DB `teachers.role` → what a session minted for that teacher may do. */
export function permissionsForRole(role: string): string[] {
  if (role === 'teacher-admin') return [USERS_READ, USERS_WRITE];
  if (role === 'moderator') return [USERS_STUDENTS];
  return [];
}

/** Full admin: every page and API in this module. */
export function isAdminPerms(perms: readonly string[] | null | undefined): boolean {
  return !!perms?.includes(USERS_WRITE);
}

/** May work on student records — an admin, or a moderator. */
export function canManageStudentsPerms(perms: readonly string[] | null | undefined): boolean {
  return !!perms && (perms.includes(USERS_WRITE) || perms.includes(USERS_STUDENTS));
}

/** Where a moderator lands, and where they are sent back to from anything else. */
export const STUDENT_HOME = '/users/students';

/**
 * The surface `users:students` opens, as path prefixes (matched exactly or as
 * a whole segment, so /api/users/students-x would not slip through).
 *
 * /api/users/meta is here because every one of these pages fills its year /
 * grade / room pickers from it; it is read-only lookup data.
 */
const STUDENT_UI = [
  '/users/students',
  '/users/placements',
  '/users/promotions',
  '/users/class-numbers',
  '/users/graduations',
  '/users/leaves',
  '/users/withdrawals',
  '/users/former-students',
];
const STUDENT_API = [
  '/api/users/students',
  '/api/users/enrollments',
  '/api/users/meta',
  '/api/users/placements',
  '/api/users/promotions',
  '/api/users/room-transfers',
  '/api/users/class-numbers',
  '/api/users/graduations',
  '/api/users/leaves',
  '/api/users/withdrawals',
];

function under(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + '/'));
}

/** Is this page / API path inside what a moderator may reach? */
export function isStudentScopePath(path: string): boolean {
  return under(path, STUDENT_UI) || under(path, STUDENT_API);
}

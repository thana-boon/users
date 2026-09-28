/**
 * Permission strings this module gates on, and the moderator capability model.
 *
 * Their own file, with no imports, so a Client Component can name a permission
 * without dragging lib/jwt.ts — and with it `jose` and JWT_SECRET — into the
 * browser bundle. lib/jwt.ts re-exports the constants, so server code can keep
 * importing them from there. Middleware (edge), the route guard (rbac.ts), the
 * menu (AppShell) and the role page all read the SAME rule table below, so the
 * four can never disagree about who may open what.
 */

/** Read access to this (admin-only) Records module. */
export const USERS_READ = 'users:read';
/** Write access — full admin: every page and API in this module. */
export const USERS_WRITE = 'users:write';

/**
 * What a moderator can be given, one tick-box each on /users/permissions.
 * Stored as the bare key in `staff_grants.capabilities`; carried in the
 * session as `users:<key>` (see capPerm).
 *
 * Never grantable, whatever is ticked: the dashboard, ถังขยะ, ตั้งค่าระบบ,
 * จัดการสิทธิ์, API Manager, สำรองข้อมูล, a teacher's role or password, and
 * the teacher Excel re-import (it overwrites passwords) — the things that would
 * let a moderator make themselves an admin or undo one.
 */
export const CAPABILITIES = [
  {
    key: 'students.registry',
    group: 'นักเรียน',
    label: 'ทะเบียนนักเรียน',
    desc: 'ดู ค้นหา เพิ่ม แก้ไข นำเข้า รูปนักเรียน',
  },
  {
    key: 'students.classes',
    group: 'นักเรียน',
    label: 'จัดห้องเรียน',
    desc: 'จัดเข้าห้อง เลื่อนชั้น/ย้ายห้อง จัดเลขที่',
  },
  {
    key: 'students.exits',
    group: 'นักเรียน',
    label: 'สถานภาพนักเรียน',
    desc: 'จบการศึกษา พักการเรียน จำหน่าย/ลาออก นักเรียนเก่า',
  },
  {
    key: 'students.sensitive',
    group: 'นักเรียน',
    label: 'ข้อมูลลับนักเรียน',
    desc: 'ดูรหัสผ่าน/เลขบัตร ส่งออก Excel (บันทึกทุกครั้ง)',
  },
  {
    key: 'staff.records',
    group: 'บุคลากร',
    label: 'ข้อมูลบุคลากร',
    desc: 'ครู อาจารย์พิเศษ คนงาน กลุ่มสาระ (ไม่รวมสิทธิ์และรหัสผ่านครู)',
  },
  {
    key: 'staff.homerooms',
    group: 'บุคลากร',
    label: 'ครูประจำชั้น',
    desc: 'กำหนดครูประจำชั้นแต่ละห้อง',
  },
  {
    key: 'staff.sensitive',
    group: 'บุคลากร',
    label: 'ข้อมูลลับบุคลากร',
    desc: 'ดูเลขบัตรประชาชน ส่งออก Excel (บันทึกทุกครั้ง)',
  },
  {
    key: 'years',
    group: 'อื่น ๆ',
    label: 'ปีการศึกษา',
    desc: 'สร้าง/แก้ไขปีการศึกษาและวันเปิด-ปิดภาคเรียน',
  },
  {
    key: 'audit',
    group: 'อื่น ๆ',
    label: 'บันทึกการใช้งาน',
    desc: 'ดูบันทึกการใช้งาน (ดูอย่างเดียว)',
  },
] as const;

export type Capability = (typeof CAPABILITIES)[number]['key'];
export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key) as Capability[];

/** Session permission string for a capability. */
export const capPerm = (c: Capability) => `users:${c}`;

export function isCapability(v: string): v is Capability {
  return (CAPABILITY_KEYS as string[]).includes(v);
}

/** The capabilities a session carries (empty for an admin — they need none). */
export function capsOf(perms: readonly string[] | null | undefined): Capability[] {
  return CAPABILITY_KEYS.filter((c) => perms?.includes(capPerm(c)));
}

/** Full admin: every page and API in this module. */
export function isAdminPerms(perms: readonly string[] | null | undefined): boolean {
  return !!perms?.includes(USERS_WRITE);
}

/** May enter the module at all — an admin, or a moderator with any grant. */
export function canEnterPerms(perms: readonly string[] | null | undefined): boolean {
  return isAdminPerms(perms) || capsOf(perms).length > 0;
}

// -- The rule table ----------------------------------------------------
//
// Path (with any BASE_PATH already stripped) → which capabilities open it,
// separately for reads (GET/HEAD) and writes. First match wins; a path that
// matches nothing is admin-only, so a NEW page or API is closed to moderators
// until someone adds it here on purpose.

type Need = readonly Capability[] | 'admin';
interface Rule {
  re: RegExp;
  read: Need;
  write?: Need; // defaults to `read`
}

const S_REG: Capability = 'students.registry';
const S_CLASSES: Capability = 'students.classes';
const S_EXITS: Capability = 'students.exits';
const S_SENS: Capability = 'students.sensitive';
const T_REC: Capability = 'staff.records';
const T_HOME: Capability = 'staff.homerooms';
const T_SENS: Capability = 'staff.sensitive';
// Every student tool reads the roster/search endpoints (the withdraw and leave
// tools search students, the boards read enrollments), so reads are open to
// any student capability and writes stay with the one that owns them.
const ANY_STUDENT = [S_REG, S_CLASSES, S_EXITS, S_SENS] as const;

const RULES: Rule[] = [
  // -- API: students
  { re: /^\/api\/users\/students\/export$/, read: [S_SENS] },
  { re: /^\/api\/users\/students\/[^/]+\/reveal$/, read: [S_SENS] },
  { re: /^\/api\/users\/students\/former$/, read: [S_EXITS] },
  { re: /^\/api\/users\/students\/unplaced$/, read: [S_CLASSES] },
  // The registry detail page has the จำหน่าย/จบ dialog too.
  { re: /^\/api\/users\/students\/[^/]+\/status$/, read: [S_REG, S_EXITS] },
  { re: /^\/api\/users\/students(\/.*)?$/, read: ANY_STUDENT, write: [S_REG] },
  { re: /^\/api\/users\/enrollments$/, read: ANY_STUDENT, write: 'admin' },
  { re: /^\/api\/users\/(placements|promotions|room-transfers|class-numbers)(\/.*)?$/, read: [S_CLASSES] },
  // The promotions board files its จบการศึกษา bucket through here.
  { re: /^\/api\/users\/graduations$/, read: [S_EXITS, S_CLASSES] },
  { re: /^\/api\/users\/(leaves|withdrawals)(\/.*)?$/, read: [S_EXITS] },
  // Year / grade / room pickers on every page. Read-only lookup data.
  { re: /^\/api\/users\/meta$/, read: CAPABILITY_KEYS, write: 'admin' },

  // -- API: staff
  { re: /^\/api\/users\/(teachers|special-teachers)\/export$/, read: [T_SENS] },
  // Teacher PASSWORDS are admin-only on top of this — see the reveal route.
  { re: /^\/api\/users\/(teachers|workers)\/[^/]+\/reveal$/, read: [T_SENS] },
  // Re-import overwrites teacher passwords, admin accounts' included.
  { re: /^\/api\/users\/teachers\/import$/, read: 'admin' },
  { re: /^\/api\/users\/(teachers|special-teachers|workers|subject-groups)(\/.*)?$/, read: [T_REC] },
  { re: /^\/api\/users\/homerooms$/, read: [T_HOME] },

  // -- API: other
  { re: /^\/api\/users\/academic-years(\/.*)?$/, read: ['years'] },
  { re: /^\/api\/users\/audit$/, read: ['audit'], write: 'admin' },

  // -- Pages
  { re: /^\/users\/students$/, read: [S_REG] },
  { re: /^\/users\/students\/[^/]+$/, read: ANY_STUDENT },
  { re: /^\/users\/(placements|promotions|class-numbers)$/, read: [S_CLASSES] },
  { re: /^\/users\/(graduations|leaves|withdrawals|former-students)$/, read: [S_EXITS] },
  { re: /^\/users\/(teachers|special-teachers|workers|subject-groups)(\/[^/]+)?$/, read: [T_REC] },
  { re: /^\/users\/homerooms$/, read: [T_HOME] },
  { re: /^\/users\/academic-years$/, read: ['years'] },
  { re: /^\/users\/audit$/, read: ['audit'] },
];

/** What this path + method needs. 'admin' for anything not in the table. */
export function needFor(path: string, method = 'GET'): Need {
  const rule = RULES.find((r) => r.re.test(path));
  if (!rule) return 'admin';
  const isRead = method === 'GET' || method === 'HEAD';
  return isRead ? rule.read : (rule.write ?? rule.read);
}

/** Do these capabilities open this path + method? (Admins: always.) */
export function allows(
  perms: readonly string[] | null | undefined,
  path: string,
  method = 'GET',
): boolean {
  if (isAdminPerms(perms)) return true;
  return capsAllow(capsOf(perms), path, method);
}

/** The same check against a bare capability list (the route guard's DB read). */
export function capsAllow(caps: readonly string[], path: string, method = 'GET'): boolean {
  const need = needFor(path, method);
  return need !== 'admin' && need.some((c) => caps.includes(c));
}

/**
 * Where a moderator lands — the first page, in menu order, they may open. Null
 * if none (which canEnterPerms rules out for anyone who got past the gate).
 */
const LANDING = [
  '/users/students',
  '/users/placements',
  '/users/graduations',
  '/users/teachers',
  '/users/homerooms',
  '/users/academic-years',
  '/users/audit',
];
export function homeFor(perms: readonly string[] | null | undefined): string | null {
  if (isAdminPerms(perms)) return '/users';
  return LANDING.find((p) => allows(perms, p)) ?? null;
}

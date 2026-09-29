/**
 * Remembers where the registry (ทะเบียนนักเรียน) was — search, ชั้น, ห้อง, page —
 * so leaving a student's record lands back on the same roll instead of a reset
 * one, and marks the student just opened so the next one down is easy to find.
 * sessionStorage: per tab, gone when the tab closes. Every access is guarded
 * because storage can be blocked (private windows, strict settings).
 */
const LIST_KEY = 'users.students.list';
const LAST_KEY = 'users.students.last';

export function rememberStudentList(search: string) {
  try { sessionStorage.setItem(LIST_KEY, search); } catch { /* storage blocked */ }
}

/** The registry URL with the filters it was last left on. */
export function studentListHref(): string {
  try {
    const s = sessionStorage.getItem(LIST_KEY);
    if (s) return `/users/students${s}`;
  } catch { /* storage blocked */ }
  return '/users/students';
}

export function rememberLastStudent(id: number) {
  try { sessionStorage.setItem(LAST_KEY, String(id)); } catch { /* storage blocked */ }
}

export function lastStudentId(): number | null {
  try {
    const v = Number(sessionStorage.getItem(LAST_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

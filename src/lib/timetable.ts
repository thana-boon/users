/**
 * Read-only client for the timetable service's public API (/timetable/api/v1).
 *
 * Used for one thing: which classes a teacher actually teaches this term, so
 * ชั้นที่สอน shows what the timetable says rather than whatever was typed into
 * the import sheet. The timetable syncs its teachers FROM this app and keeps
 * our `teachers.id` as its own primary key, so our id is the `:id` it expects.
 *
 * Server-only: the API key carries `schedule:read` for the whole school and
 * must never reach a browser.
 *
 * Every failure (not configured, unreachable, slow, non-200, odd body) comes
 * back as `null`, never a throw. The timetable is a nicety on a profile page;
 * it being down must not take the page — or the stored ชั้นที่สอน — with it.
 */

const TIMEOUT_MS = 4000;

export interface TeachingClasses {
  /** e.g. [{ grade: 'ม.3', sections: ['1','2','5'] }, { grade: 'ม.6', sections: ['1'] }] */
  groups: { grade: string; sections: string[] }[];
  /** e.g. "เทอม 1/2569" — the term the timetable answered for. */
  term: string | null;
}

interface Cell {
  gradeLevel?: string | null;
  section?: string | null;
}

interface Term {
  name?: string | null;
  year?: number | null;
  semester?: number | null;
}

function config() {
  const base = process.env.TIMETABLE_API_URL?.trim().replace(/\/+$/, '');
  const key = process.env.TIMETABLE_API_KEY?.trim();
  return base && key ? { base, key } : null;
}

export function timetableConfigured(): boolean {
  return config() !== null;
}

// อ.1 < ป.1 < ม.1 — the order the school reads its own grades in.
const STAGE_ORDER = ['อ.', 'ป.', 'ม.'];
function gradeRank(g: string): [number, number] {
  const stage = STAGE_ORDER.findIndex((p) => g.startsWith(p));
  const n = Number(g.replace(/\D+/g, ''));
  return [stage === -1 ? STAGE_ORDER.length : stage, Number.isFinite(n) ? n : 0];
}

export function groupClasses(cells: Cell[]): TeachingClasses['groups'] {
  const byGrade = new Map<string, Set<string>>();
  for (const c of cells) {
    const grade = c.gradeLevel?.trim();
    if (!grade) continue;
    const set = byGrade.get(grade) ?? new Set<string>();
    const section = c.section?.trim();
    if (section) set.add(section);
    byGrade.set(grade, set);
  }
  const collator = new Intl.Collator('th', { numeric: true });
  return [...byGrade.entries()]
    .sort(([a], [b]) => {
      const [sa, na] = gradeRank(a);
      const [sb, nb] = gradeRank(b);
      return sa - sb || na - nb || collator.compare(a, b);
    })
    .map(([grade, s]) => ({ grade, sections: [...s].sort(collator.compare) }));
}

function termLabel(t: Term | null | undefined): string | null {
  if (!t) return null;
  if (t.semester && t.year) return `ภาคเรียนที่ ${t.semester}/${t.year}`;
  return t.name?.trim() || null;
}

/** The classes this teacher teaches in the timetable's current term, or null. */
export async function fetchTeachingClasses(teacherId: number): Promise<TeachingClasses | null> {
  const cfg = config();
  if (!cfg || !Number.isInteger(teacherId) || teacherId <= 0) return null;
  try {
    const res = await fetch(`${cfg.base}/api/v1/schedule/teacher/${teacherId}`, {
      headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[timetable] teacher ${teacherId}: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { data?: Cell[]; term?: Term };
    if (!Array.isArray(body.data)) return null;
    return { groups: groupClasses(body.data), term: termLabel(body.term) };
  } catch (err) {
    console.warn(`[timetable] teacher ${teacherId}:`, (err as Error).message);
    return null;
  }
}

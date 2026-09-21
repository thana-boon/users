import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { appSettings } from '@/db/schema';

/**
 * School-wide switches, stored in `app_settings` and flipped from /users/settings.
 *
 * Today there are two, and they are the same question asked of two audiences:
 * may a teacher / a student edit their own record right now? Separate keys on
 * purpose — the office opens the staff window in May when everyone files their
 * new วุฒิ, and the student window in the first week of term, and those are not
 * the same week.
 *
 * An absent row means the default below, so nothing needs seeding and a new
 * setting can be added without a migration of values.
 */

export const SELF_EDIT_TEACHERS = 'self_edit_teachers';
export const SELF_EDIT_STUDENTS = 'self_edit_students';

export type SelfEditAudience = 'teacher' | 'student';

const KEY_OF: Record<SelfEditAudience, string> = {
  teacher: SELF_EDIT_TEACHERS,
  student: SELF_EDIT_STUDENTS,
};

/**
 * Default: teachers open, students closed.
 *
 * Not symmetry for its own sake. A teacher is an adult maintaining their own
 * staff record and is the only source for วุฒิ/การอบรม, so the feature is
 * useless switched off. The student window is one the school opens
 * deliberately — "กรอกข้อมูลสุขภาพภายในศุกร์นี้" — and a window nobody opened
 * should not be standing open.
 */
const DEFAULTS: Record<string, string> = {
  [SELF_EDIT_TEACHERS]: 'on',
  [SELF_EDIT_STUDENTS]: 'off',
};

/**
 * A short in-process cache. Every self-service request asks this question, and
 * the answer changes a few times a year — but the TTL is seconds, not minutes,
 * so an admin who closes the window sees it close while they are still looking
 * at the page. Per server process: with more than one, a flip takes at most one
 * TTL to be true everywhere, which is the right trade for a switch nobody flips
 * in a hurry.
 */
const TTL_MS = 5_000;
let cache: { at: number; values: Record<string, string> } | null = null;

async function readAll(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const values = { ...DEFAULTS };
  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, Object.keys(DEFAULTS)));
    for (const r of rows) values[r.key] = r.value;
  } catch (err) {
    // Fail to the DEFAULTS rather than to an error page: a settings table that
    // is unreachable must not take the whole module down with it.
    console.error('[settings] read failed, using defaults:', err);
  }
  cache = { at: Date.now(), values };
  return values;
}

/** Both switches, as the settings page and /api/users/me report them. */
export async function readSelfEditSettings(): Promise<Record<SelfEditAudience, boolean>> {
  const values = await readAll();
  return {
    teacher: values[SELF_EDIT_TEACHERS] === 'on',
    student: values[SELF_EDIT_STUDENTS] === 'on',
  };
}

/** May this audience edit their own record right now? */
export async function selfEditEnabled(audience: SelfEditAudience): Promise<boolean> {
  return (await readSelfEditSettings())[audience];
}

/** Flip one switch. Returns the value actually stored. */
export async function setSelfEdit(
  audience: SelfEditAudience,
  enabled: boolean,
  actorLabel: string | null,
): Promise<boolean> {
  const value = enabled ? 'on' : 'off';
  await db
    .insert(appSettings)
    .values({ key: KEY_OF[audience], value, updatedBy: actorLabel })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: actorLabel },
    });
  cache = null; // the admin who flipped it must see it flipped
  return enabled;
}

/**
 * The 403 a closed window produces. One message in one place, because it is
 * shown by the API and echoed by the page, and the two saying different things
 * is how a teacher ends up phoning the office about a bug that is a setting.
 */
export function selfEditClosedMessage(audience: SelfEditAudience): string {
  const who = audience === 'teacher' ? 'ครู' : 'นักเรียน';
  return `ขณะนี้โรงเรียนปิดการแก้ไขข้อมูลด้วยตนเองสำหรับ${who} กรุณาติดต่อผู้ดูแลระบบ`;
}

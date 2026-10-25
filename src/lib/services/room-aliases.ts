import { db } from '@/db';
import { roomAliases } from '@/db/schema';

/**
 * ชื่อห้อง — an optional display name per (ชั้น, ห้อง), e.g. อ.3/1 → เฟื่องฟ้า.
 * The number stays the key everywhere; these helpers only attach the name for
 * display and for API consumers.
 */

export const roomKey = (gradeLevel: string, classroom: string) => `${gradeLevel}|${classroom}`;

/** Trim + collapse inner whitespace — the one normalisation an alias gets. */
export function cleanAlias(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/** Every alias, keyed by roomKey(). The whole table is a few dozen rows. */
export async function readAliasMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ gradeLevel: roomAliases.gradeLevel, classroom: roomAliases.classroom, alias: roomAliases.alias })
    .from(roomAliases);
  return new Map(rows.map((r) => [roomKey(r.gradeLevel, r.classroom), r.alias]));
}

/** "อ.3/เฟื่องฟ้า" when the room has an alias, else "อ.3/1". */
export function roomLabel(gradeLevel: string, classroom: string, alias: string | null | undefined): string {
  return `${gradeLevel}/${alias || classroom}`;
}

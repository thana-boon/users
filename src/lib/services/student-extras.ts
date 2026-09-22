import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { guardians, studentAddresses, studentHealth } from '@/db/schema';
import { normalizePhoneFields } from '@/lib/phone';

/**
 * The two opt-in blocks the public student feed can attach to a roster row:
 * ข้อมูลสุขภาพ and ผู้ติดต่อฉุกเฉิน — plus the one write the feed accepts back.
 *
 * WHY THEY ARE NOT IN THE ROSTER ROW. Both are read by `?include=`, each behind
 * its own additive scope, for the same reason เลขบัตร ปชช. is: the common
 * integration wants a list of names and ชั้น/ห้อง, and a feed that shipped a
 * child's drug allergies and their mother's mobile number to every such caller
 * would be handing out data nobody asked for and nobody can take back.
 *
 * WHY THEY ARE SEPARATE FROM EACH OTHER. The ห้องพยาบาล system needs the health
 * block and has no business holding parents' phone numbers; an automated
 * calling system needs the contacts and has no business holding a child's
 * chronic illnesses. One scope covering both would force each to take the
 * other's data.
 *
 * Batch shaped (ids in, Map out) because the list route attaches these to a
 * page of up to 200 students: one query per block per page, never one per row.
 */

// -- health ---------------------------------------------------------

export interface StudentHealthBlock {
  weight: string | null;
  height: string | null;
  bloodType: string | null;
  foodAllergy: string | null;
  drugAllergy: string | null;
  otherAllergy: string | null;
  chronicDisease: string | null;
  seriousDisease: string | null;
}

/**
 * ข้อมูลสุขภาพ for a page of students.
 *
 * A student with no `student_health` row gets a block of nulls rather than
 * being absent from the map — "we hold nothing on file" and "this student does
 * not exist" are different answers, and a consumer that had to tell them apart
 * by a missing key would get it wrong. The shape is the same either way.
 */
export async function readHealthFor(ids: number[]): Promise<Map<number, StudentHealthBlock>> {
  const out = new Map<number, StudentHealthBlock>();
  if (ids.length === 0) return out;

  const rows = await db
    .select()
    .from(studentHealth)
    .where(inArray(studentHealth.studentId, ids));

  const byId = new Map(rows.map((r) => [r.studentId, r]));
  for (const id of ids) {
    const r = byId.get(id);
    out.set(id, {
      weight: r?.weight ?? null,
      height: r?.height ?? null,
      bloodType: r?.bloodType ?? null,
      foodAllergy: r?.foodAllergy ?? null,
      drugAllergy: r?.drugAllergy ?? null,
      otherAllergy: r?.otherAllergy ?? null,
      chronicDisease: r?.chronicDisease ?? null,
      seriousDisease: r?.seriousDisease ?? null,
    });
  }
  return out;
}

// -- emergency contact ----------------------------------------------

export interface GuardianContact {
  type: 'guardian' | 'father' | 'mother';
  relationship: string | null;
  fullName: string | null;
  mobilePhone: string | null;
  homePhone: string | null;
  workPhone: string | null;
}

export interface StudentContactBlock {
  /** From ที่อยู่ปัจจุบัน — the number the school calls first. */
  emergencyPhone: string | null;
  emergencyEmail: string | null;
  /** เบอร์บ้านของที่อยู่ปัจจุบัน. */
  homePhone: string | null;
  livingWith: string | null;
  nearbyFriendName: string | null;
  nearbyFriendPhone: string | null;
  /**
   * ผู้ปกครอง/บิดา/มารดา with their numbers. Read-only here and forever: a
   * guardian is a record about a third person who never dealt with the
   * integration asking, so an outside system may look one up but may not
   * rewrite one. See `emergencyContactSchema` for what IS writable.
   */
  guardians: GuardianContact[];
}

const EMPTY_CONTACT = (): StudentContactBlock => ({
  emergencyPhone: null,
  emergencyEmail: null,
  homePhone: null,
  livingWith: null,
  nearbyFriendName: null,
  nearbyFriendPhone: null,
  guardians: [],
});

function joinName(
  first: string | null,
  last: string | null,
  prefix?: string | null,
): string | null {
  const n = `${prefix ?? ''}${first ?? ''} ${last ?? ''}`.trim();
  return n || null;
}

/** ผู้ติดต่อฉุกเฉิน for a page of students. Two queries, whatever the page size. */
export async function readContactsFor(ids: number[]): Promise<Map<number, StudentContactBlock>> {
  const out = new Map<number, StudentContactBlock>();
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, EMPTY_CONTACT());

  const [addrs, gds] = await Promise.all([
    db
      .select()
      .from(studentAddresses)
      .where(
        and(
          inArray(studentAddresses.studentId, ids),
          // ที่อยู่ปัจจุบัน only — the household row is a registry fact and
          // carries no emergency fields at all.
          eq(studentAddresses.addressType, 'current'),
        ),
      ),
    db.select().from(guardians).where(inArray(guardians.studentId, ids)),
  ]);

  for (const a of addrs) {
    const block = out.get(a.studentId);
    if (!block) continue;
    block.emergencyPhone = a.emergencyPhone;
    block.emergencyEmail = a.emergencyEmail;
    block.homePhone = a.phone;
    block.livingWith = joinName(a.livingWith, a.livingWithLastname);
    block.nearbyFriendName = joinName(a.nearbyFriendName, a.nearbyFriendLastname);
    block.nearbyFriendPhone = a.nearbyFriendPhone;
  }

  for (const g of gds) {
    const block = out.get(g.studentId);
    if (!block) continue;
    block.guardians.push({
      type: g.guardianType,
      relationship: g.relationship,
      fullName: joinName(g.firstName, g.lastName, g.prefix),
      mobilePhone: g.mobilePhone,
      homePhone: g.homePhone,
      workPhone: g.workPhone,
    });
  }

  // Stable order so a consumer diffing two pulls sees no phantom change:
  // ผู้ปกครอง first because that is who the school calls, then บิดา, มารดา.
  const ORDER = { guardian: 0, father: 1, mother: 2 } as const;
  for (const block of out.values()) {
    block.guardians.sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  }
  return out;
}

// -- the one write --------------------------------------------------

/**
 * Everything `students:contact:write` may set, and nothing else.
 *
 * `.strict()`, so a payload naming any other column is a 400 rather than a
 * silently dropped key — an integration that thinks it is updating a name must
 * be told it is not. Every field is optional and absence means "leave alone",
 * so the usual call ("here is the เบอร์ฉุกเฉิน this parent just gave us") is a
 * one-key body that cannot blank out the rest of the block by omission.
 *
 * `null` (or '') clears a field on purpose: "this number is no longer valid" is
 * a real thing the other system learns and has to be able to tell us.
 */
export const emergencyContactSchema = z
  .object({
    emergencyPhone: z.string().nullable().optional(),
    emergencyEmail: z.string().nullable().optional(),
    homePhone: z.string().nullable().optional(),
    livingWith: z.string().nullable().optional(),
    livingWithLastname: z.string().nullable().optional(),
    nearbyFriendName: z.string().nullable().optional(),
    nearbyFriendLastname: z.string().nullable().optional(),
    nearbyFriendPhone: z.string().nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'ต้องระบุอย่างน้อยหนึ่งช่อง' });

export type EmergencyContactPatch = z.infer<typeof emergencyContactSchema>;

/** The writable columns, mapped from the payload's names to the table's. */
const WRITABLE_COLUMN: Record<keyof EmergencyContactPatch, string> = {
  emergencyPhone: 'emergencyPhone',
  emergencyEmail: 'emergencyEmail',
  homePhone: 'phone', // the payload calls it what the read block calls it
  livingWith: 'livingWith',
  livingWithLastname: 'livingWithLastname',
  nearbyFriendName: 'nearbyFriendName',
  nearbyFriendLastname: 'nearbyFriendLastname',
  nearbyFriendPhone: 'nearbyFriendPhone',
};

const WRITE_PHONE_KEYS = ['emergencyPhone', 'phone', 'nearbyFriendPhone'] as const;

/**
 * Write the emergency contact block, creating the ที่อยู่ปัจจุบัน row if the
 * student has none. Returns the field names actually set, for the audit line.
 *
 * `addressType: 'current'` is written here, never taken from the payload — the
 * same rule the student self-service route follows, so no request can aim this
 * at ที่อยู่ตามทะเบียนบ้าน.
 */
export async function writeEmergencyContact(
  studentId: number,
  patch: EmergencyContactPatch,
): Promise<string[]> {
  const set: Record<string, string | null> = {};
  for (const [key, column] of Object.entries(WRITABLE_COLUMN)) {
    if (!(key in patch)) continue;
    const v = patch[key as keyof EmergencyContactPatch] ?? null;
    // '' and null both mean "no value on file"; a stored '' would be a value
    // that looks like data to everything downstream.
    set[column] = typeof v === 'string' && v.trim() === '' ? null : v;
  }
  // The same trailing-separator rule every other phone write follows, so a
  // number arriving as "0812345678-" cannot recreate the mess the first import
  // left behind. See lib/phone.ts.
  const values = normalizePhoneFields(set, WRITE_PHONE_KEYS);

  await db
    .insert(studentAddresses)
    .values({ studentId, addressType: 'current', ...values })
    .onConflictDoUpdate({
      target: [studentAddresses.studentId, studentAddresses.addressType],
      set: values,
    });

  return Object.keys(patch);
}

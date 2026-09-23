import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { guardians, previousSchools, studentAddresses, studentHealth } from '@/db/schema';

/**
 * The opt-in blocks the public student feed can attach to a roster row:
 * ข้อมูลสุขภาพ, ผู้ติดต่อฉุกเฉิน and สถานศึกษาเดิม. Read only — the public API's single write
 * is PATCH /students/[id]/additional-phone, which touches neither of them.
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
   * rewrite one. Nothing in this block is writable through the public API.
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

// -- previous school (สถานศึกษาเดิม) --------------------------------

export interface StudentEducationBlock {
  schoolName: string | null;
  subDistrict: string | null;
  district: string | null;
  province: string | null;
  qualification: string | null;
  gpa: string | null;
}

/**
 * สถานศึกษาเดิม for a page of students — where the child came from, the
 * qualification they arrived with and its GPA. The block a ระบบรับสมัคร/
 * ทะเบียน needs to build เอกสารรับย้าย without re-typing what the office
 * already holds.
 *
 * `transferReason` (เหตุที่ย้าย) is deliberately NOT here, for the same reason
 * `exitReason` is absent from the by-id route: the free text a parent gave for
 * moving a child can record family circumstances — illness, separation, debt —
 * that no roster integration needs in order to do its job. A consumer that
 * genuinely needs it reads it in the office UI, where the person reading is a
 * person and not a key.
 *
 * Missing row → a block of nulls, same as health: "we hold no previous school
 * on file" and "no such student" are different answers.
 */
export async function readEducationFor(
  ids: number[],
): Promise<Map<number, StudentEducationBlock>> {
  const out = new Map<number, StudentEducationBlock>();
  if (ids.length === 0) return out;

  const rows = await db
    .select()
    .from(previousSchools)
    .where(inArray(previousSchools.studentId, ids));

  const byId = new Map(rows.map((r) => [r.studentId, r]));
  for (const id of ids) {
    const r = byId.get(id);
    out.set(id, {
      schoolName: r?.schoolName ?? null,
      subDistrict: r?.subDistrict ?? null,
      district: r?.district ?? null,
      province: r?.province ?? null,
      qualification: r?.qualification ?? null,
      gpa: r?.gpa ?? null,
    });
  }
  return out;
}

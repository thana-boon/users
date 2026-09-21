import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students, studentAddresses, studentHealth } from '@/db/schema';
import { maskCitizenId, tryDecrypt } from '@/lib/crypto';

/**
 * What a STUDENT may see and change about themselves — the twin of
 * SELF_EDITABLE in services/teachers.ts, and deliberately a much smaller door.
 *
 * A student record is a school document (ปพ.1 and friends) assembled from
 * papers handed in at admission. Almost none of it is the student's to revise.
 * Three things are the exception, and they are exactly the three the office
 * cannot keep current on its own:
 *
 *  1. เบอร์โทร / ชื่อเล่น — the contact details that change without anyone
 *     telling the office.
 *  2. ข้อมูลสุขภาพ — น้ำหนัก ส่วนสูง กรุ๊ปเลือด แพ้อาหาร/ยา โรคประจำตัว. This
 *     is the one block where "out of date" is a safety problem rather than a
 *     tidiness one, and the student is the only person who knows it.
 *  3. ที่อยู่ปัจจุบัน — where they actually live now, plus the emergency
 *     contact and the เพื่อนใกล้บ้าน beside it. NOT ที่อยู่ตามทะเบียนบ้าน,
 *     which is a registry fact copied from the house registration document.
 *
 * LOCKED, and why:
 *  - ชื่อ/นามสกุล/คำนำหน้า/วันเกิด/เพศ/ศาสนา/สัญชาติ/เชื้อชาติ/เลขบัตร ปชช. —
 *    printed on official documents and taken from the papers at admission.
 *  - email — a login identifier (api/auth/student-login accepts it).
 *  - ชั้น/ห้อง/เลขที่/สถานะ — decided by the school, not claimed by the pupil.
 *  - ผู้ปกครอง — a record ABOUT someone else, and the one the school acts on in
 *    an emergency. The emergency contact in ที่อยู่ปัจจุบัน covers the "our
 *    number changed" case without letting a child rewrite their guardians.
 *  - รูปติดบัตร — an official photo, unlike a teacher's staff-directory one.
 *    Taken by the school, replaced by the school.
 */

const nstr = z.string().nullable().optional();

/** The student's own scalar fields. */
export const STUDENT_SELF_EDITABLE = ['phone', 'nickname', 'nicknameEn'] as const;

/** Every column of `student_health` — the whole block is the student's own. */
export const healthSchema = z.object({
  weight: nstr,
  height: nstr,
  bloodType: nstr,
  foodAllergy: nstr,
  drugAllergy: nstr,
  otherAllergy: nstr,
  chronicDisease: nstr,
  seriousDisease: nstr,
});

/**
 * ที่อยู่ปัจจุบัน only. `addressType` is not in the schema on purpose — the
 * route writes 'current' itself, so no payload can steer this at the household
 * or birth-place row.
 */
export const currentAddressSchema = z.object({
  houseNo: nstr,
  moo: nstr,
  soi: nstr,
  road: nstr,
  subDistrict: nstr,
  district: nstr,
  province: nstr,
  postalCode: nstr,
  phone: nstr,
  livingWith: nstr,
  livingWithLastname: nstr,
  houseType: nstr,
  emergencyEmail: nstr,
  emergencyPhone: nstr,
  nearbyFriendName: nstr,
  nearbyFriendLastname: nstr,
  nearbyFriendPhone: nstr,
});

/** The whole self-service payload. `.strict()`: a locked field is a 400. */
export const studentSelfPatchSchema = z
  .object({
    phone: nstr,
    nickname: nstr,
    nicknameEn: nstr,
    health: healthSchema.optional(),
    currentAddress: currentAddressSchema.optional(),
  })
  .strict();

export type StudentSelfPatch = z.infer<typeof studentSelfPatchSchema>;

/** '' means "cleared", which is null in the database. */
function blankToNull<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
  }
  return out as T;
}

/**
 * Apply a student's self-edit: scalars on `students`, plus the two child rows,
 * each created on first save (a student who never had a health row gets one).
 */
export async function applyStudentSelfPatch(
  studentId: number,
  body: StudentSelfPatch,
): Promise<string[]> {
  const { health, currentAddress, ...scalars } = body;
  const changed: string[] = [];

  await db.transaction(async (tx) => {
    const set = blankToNull(scalars);
    if (Object.keys(set).length) {
      await tx.update(students).set(set).where(eq(students.id, studentId));
      changed.push(...Object.keys(set));
    }

    if (health) {
      const values = blankToNull(health);
      // onConflictDoUpdate against the unique student_id, so the first save
      // creates the row and later ones update it.
      await tx
        .insert(studentHealth)
        .values({ studentId, ...values })
        .onConflictDoUpdate({ target: studentHealth.studentId, set: values });
      changed.push('ข้อมูลสุขภาพ');
    }

    if (currentAddress) {
      const values = blankToNull(currentAddress);
      await tx
        .insert(studentAddresses)
        .values({ studentId, addressType: 'current', ...values })
        .onConflictDoUpdate({
          // The unique key is (student_id, address_type) — see the table.
          target: [studentAddresses.studentId, studentAddresses.addressType],
          set: values,
        });
      changed.push('ที่อยู่ปัจจุบัน');
    }
  });

  return changed;
}

/**
 * The student's own record as the self-service page reads it: identity (shown
 * but locked), the current enrollment, and the two blocks they may edit.
 * Ciphertext never leaves; เลขบัตร ปชช. is masked, as everywhere else.
 */
export async function readStudentProfile(id: number) {
  const s = await db.query.students.findFirst({
    where: eq(students.id, id),
    with: {
      enrollments: { with: { academicYear: true } },
      health: true,
    },
  });
  if (!s) return null;

  const current = await db.query.studentAddresses.findFirst({
    where: and(eq(studentAddresses.studentId, id), eq(studentAddresses.addressType, 'current')),
  });

  const { passwordEncrypted, citizenIdEncrypted, photoBase64, enrollments, ...core } = s;

  // The latest year this student is enrolled in — what ชั้น/ห้อง means on a
  // page with no year picker.
  const latest = [...enrollments].sort(
    (a, b) => (b.academicYear?.year ?? 0) - (a.academicYear?.year ?? 0),
  )[0];

  return {
    ...core,
    citizenIdMasked: maskCitizenId(tryDecrypt(citizenIdEncrypted)),
    hasCitizenId: !!citizenIdEncrypted,
    hasPassword: !!passwordEncrypted,
    hasPhoto: !!photoBase64,
    enrollment: latest
      ? {
          gradeLevel: latest.gradeLevel,
          classroom: latest.classroom,
          classNumber: latest.classNumber,
          year: latest.academicYear?.year ?? null,
        }
      : null,
    currentAddress: current ?? null,
  };
}

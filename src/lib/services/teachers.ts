import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  teachers,
  teacherEducations,
  teacherScoutQualifications,
  teacherTrainings,
} from '@/db/schema';
import type {
  TeacherEducation,
  TeacherScoutQualification,
  TeacherTraining,
} from '@/db/schema';
import { maskCitizenId, tryDecrypt } from '@/lib/crypto';
import { phoneField } from '@/lib/phone';
import { isValidCitizenId } from '@/lib/thai';

/**
 * A teacher's profile as both front doors read and write it: the admin route
 * (/api/users/teachers/[id]) and the teacher's own (/api/users/me).
 *
 * They share this file so the two can never disagree about the shape of a
 * record — and, more importantly, so the ONE list of "what a teacher may change
 * about themselves" (SELF_EDITABLE) lives in a single place that the API
 * enforces and the UI reads to decide what to grey out.
 */

// -- the three repeatable lists --------------------------------------

const nstr = z.string().nullable().optional();

/**
 * Each list is saved wholesale: the payload IS the list, and whatever is not in
 * it is gone. Row ids are therefore never sent — an id would only invite the
 * caller to try and move a row between teachers.
 */
export const educationSchema = z.object({
  degreeLevel: nstr,
  degreeName: nstr,
  major: nstr,
  faculty: nstr,
  institution: nstr,
  graduationYear: nstr,
});

export const scoutQualificationSchema = z.object({
  qualification: nstr,
  scoutType: nstr,
  trainedAt: nstr,
  certificateNo: nstr,
  issuedDate: nstr,
});

export const trainingSchema = z.object({
  title: nstr,
  organizer: nstr,
  venue: nstr,
  hours: nstr,
  startDate: nstr,
  endDate: nstr,
  certificateNo: nstr,
});

/**
 * A ceiling on each list. Not a policy about teachers — nobody holds 50 degrees
 * — but a bound on what one PATCH can insert, since the whole list is replaced
 * on every save.
 */
const MAX_ROWS = 50;

export const teacherListsSchema = z.object({
  educations: z.array(educationSchema).max(MAX_ROWS).optional(),
  scoutQualifications: z.array(scoutQualificationSchema).max(MAX_ROWS).optional(),
  trainings: z.array(trainingSchema).max(MAX_ROWS).optional(),
});

export type TeacherLists = z.infer<typeof teacherListsSchema>;

/** '' and '   ' mean "left blank", which is null in the database, not a value. */
function blankToNull<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
  }
  return out as T;
}

/** A row where every field was left blank is a row the user forgot to delete. */
function hasContent(row: Record<string, unknown>): boolean {
  return Object.values(row).some((v) => v !== null && v !== undefined && v !== '');
}

/**
 * Replace whichever lists the payload carries, in one transaction.
 *
 * Delete-then-insert rather than a per-row diff, the same choice
 * upsertStudentFull() makes for addresses/guardians: these rows have no natural
 * key (two "อบรม PLC 6 ชั่วโมง" rows are a legitimate pair), so a diff would
 * have to invent one. A list the payload does not mention is left alone — that
 * is what lets the self-service form send only its own three lists.
 */
export async function replaceTeacherLists(
  teacherId: number,
  lists: TeacherLists,
): Promise<void> {
  const { educations, scoutQualifications, trainings } = lists;
  if (!educations && !scoutQualifications && !trainings) return;

  await db.transaction(async (tx) => {
    if (educations) {
      await tx.delete(teacherEducations).where(eq(teacherEducations.teacherId, teacherId));
      const rows = educations.map(blankToNull).filter(hasContent);
      if (rows.length) {
        await tx
          .insert(teacherEducations)
          .values(rows.map((r, i) => ({ ...r, teacherId, sortOrder: i })));
      }
    }

    if (scoutQualifications) {
      await tx
        .delete(teacherScoutQualifications)
        .where(eq(teacherScoutQualifications.teacherId, teacherId));
      const rows = scoutQualifications.map(blankToNull).filter(hasContent);
      if (rows.length) {
        await tx
          .insert(teacherScoutQualifications)
          .values(rows.map((r, i) => ({ ...r, teacherId, sortOrder: i })));
      }
    }

    if (trainings) {
      await tx.delete(teacherTrainings).where(eq(teacherTrainings.teacherId, teacherId));
      const rows = trainings.map(blankToNull).filter(hasContent);
      if (rows.length) {
        await tx
          .insert(teacherTrainings)
          .values(rows.map((r, i) => ({ ...r, teacherId, sortOrder: i })));
      }
    }
  });
}

// -- ที่อยู่ตามทะเบียนบ้าน / ผู้ติดต่อฉุกเฉิน / เดือนปีที่เข้าทำงาน ----------

/**
 * The address travels as ONE nested object everywhere outside the database —
 * the admin form, the teacher's own form, the public API in both directions —
 * and becomes nine `addr_*` columns only here. The key names match a student
 * address (lib/services/students.ts ADDRESS_FIELDS), so a consumer that already
 * reads one reads the other.
 */
export const HOUSEHOLD_ADDRESS_KEYS = [
  'houseNo', 'moo', 'soi', 'road', 'subDistrict', 'district', 'province', 'postalCode',
  'houseRegCode',
] as const;

type HouseholdKey = (typeof HOUSEHOLD_ADDRESS_KEYS)[number];
export type HouseholdAddress = Partial<Record<HouseholdKey, string | null>>;

const ADDRESS_COLUMN: Record<HouseholdKey, keyof typeof teachers.$inferInsert> = {
  houseNo: 'addrHouseNo',
  moo: 'addrMoo',
  soi: 'addrSoi',
  road: 'addrRoad',
  subDistrict: 'addrSubDistrict',
  district: 'addrDistrict',
  province: 'addrProvince',
  postalCode: 'addrPostalCode',
  houseRegCode: 'addrHouseRegCode',
};

export const householdAddressSchema = z
  .object(Object.fromEntries(HOUSEHOLD_ADDRESS_KEYS.map((k) => [k, nstr])) as Record<
    HouseholdKey,
    typeof nstr
  >)
  .strict();

/** Nested address → the columns to set. Only keys present in the payload. */
export function householdAddressColumns(a: HouseholdAddress): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of HOUSEHOLD_ADDRESS_KEYS) {
    if (a[k] === undefined) continue;
    const v = a[k];
    out[ADDRESS_COLUMN[k]] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  return out;
}

/** A teacher row → its nested address (every key present, null when blank). */
export function householdAddressOf(row: object): Record<HouseholdKey, string | null> {
  const cols = row as Record<string, unknown>;
  const out = {} as Record<HouseholdKey, string | null>;
  for (const k of HOUSEHOLD_ADDRESS_KEYS) out[k] = (cols[ADDRESS_COLUMN[k]] as string | null) ?? null;
  return out;
}

/** Drop the flat `addr_*` columns from a row that is about to be published. */
export function withoutAddressColumns<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of HOUSEHOLD_ADDRESS_KEYS) delete out[ADDRESS_COLUMN[k]];
  return out as T;
}

/** The same columns, for a drizzle `select({...})` that wants them by name. */
export const HOUSEHOLD_ADDRESS_COLUMNS = {
  addrHouseNo: teachers.addrHouseNo,
  addrMoo: teachers.addrMoo,
  addrSoi: teachers.addrSoi,
  addrRoad: teachers.addrRoad,
  addrSubDistrict: teachers.addrSubDistrict,
  addrDistrict: teachers.addrDistrict,
  addrProvince: teachers.addrProvince,
  addrPostalCode: teachers.addrPostalCode,
  addrHouseRegCode: teachers.addrHouseRegCode,
};

/**
 * เดือน/ปีที่เข้าทำงาน as "mm/BBBB". A พ.ศ. year is enforced by range, since the
 * commonest slip is typing the ค.ศ. year and it would sit there 543 years out.
 * '' clears it.
 */
export const workStartField = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v == null ? v : v.trim() === '' ? null : v.trim()))
  .refine(
    (v) => {
      if (v == null) return true;
      const m = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(v);
      return !!m && Number(m[2]) >= 2400 && Number(m[2]) <= 2700;
    },
    { message: 'เดือน/ปีที่เข้าทำงานต้องเป็น ดด/ปปปป (พ.ศ.) เช่น 05/2560' },
  );

/**
 * The profile fields a teacher, an admin AND an outside system all write the
 * same way — contact, demographics, วันเกิด, ผู้ติดต่อฉุกเฉิน, ที่อยู่, วันเข้าทำงาน.
 * One schema so the three doors cannot drift apart on what a value may be.
 */
export const teacherProfileFieldsSchema = z.object({
  phone: phoneField,
  lineId: nstr,
  birthDate: nstr, // raw Thai dd/mm/BBBB
  gender: nstr,
  religion: nstr,
  nationality: nstr,
  ethnicity: nstr,
  emergencyContactName: nstr,
  emergencyPhone: phoneField,
  emergencyRelationship: nstr,
  householdAddress: householdAddressSchema.optional(),
  workStart: workStartField,
});

/**
 * Turn a parsed profile patch into the columns to write. Blank strings become
 * null; the nested address fans out into its columns; phones were already
 * normalized by `phoneField` during parse.
 */
export function profileColumns(
  body: Partial<z.infer<typeof teacherProfileFieldsSchema>> & Record<string, unknown>,
): Record<string, unknown> {
  const { householdAddress, ...rest } = body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
  }
  if (householdAddress) Object.assign(out, householdAddressColumns(householdAddress));
  return out;
}

/** How many rows each list gained/lost — the readable half of an audit line. */
export function describeLists(lists: TeacherLists): string[] {
  const parts: string[] = [];
  if (lists.educations) parts.push(`วุฒิการศึกษา ${lists.educations.length} รายการ`);
  if (lists.scoutQualifications)
    parts.push(`วุฒิลูกเสือ ${lists.scoutQualifications.length} รายการ`);
  if (lists.trainings) parts.push(`การอบรม ${lists.trainings.length} รายการ`);
  return parts;
}

// -- reading a full profile ------------------------------------------

/**
 * One teacher with their three lists, shaped for the API: ciphertext and the
 * photo blob stripped, sensitive values masked, ordered by the position the
 * teacher put them in.
 */
export async function readTeacherProfile(id: number) {
  const t = await db.query.teachers.findFirst({
    where: eq(teachers.id, id),
    with: {
      educations: { orderBy: [asc(teacherEducations.sortOrder), asc(teacherEducations.id)] },
      scoutQualifications: {
        orderBy: [asc(teacherScoutQualifications.sortOrder), asc(teacherScoutQualifications.id)],
      },
      trainings: { orderBy: [asc(teacherTrainings.sortOrder), asc(teacherTrainings.id)] },
    },
  });
  if (!t) return null;

  const { passwordEncrypted, citizenIdEncrypted, photoBase64, ...core } = t;
  return {
    ...withoutAddressColumns(core),
    householdAddress: householdAddressOf(core),
    citizenIdMasked: maskCitizenId(tryDecrypt(citizenIdEncrypted)),
    hasCitizenId: !!citizenIdEncrypted,
    hasPassword: !!passwordEncrypted,
    hasPhoto: !!photoBase64,
  };
}

export type TeacherProfile = NonNullable<Awaited<ReturnType<typeof readTeacherProfile>>>;

/** One teacher's three lists, in the shape the public API publishes them. */
export interface PublicQualifications {
  educations: Omit<TeacherEducation, 'id' | 'teacherId' | 'sortOrder'>[];
  scoutQualifications: Omit<TeacherScoutQualification, 'id' | 'teacherId' | 'sortOrder'>[];
  trainings: Omit<TeacherTraining, 'id' | 'teacherId' | 'sortOrder'>[];
}

/**
 * The three lists for a page of teachers, as three queries rather than 3×N.
 *
 * Row ids and `sort_order` are dropped on the way out: they are this database's
 * bookkeeping, they change on every save (the lists are replaced wholesale), and
 * a consumer that stored one would be storing a number that means nothing next
 * week. Order is the contract instead — the array arrives in the order the
 * teacher arranged it.
 */
export async function readQualificationsFor(
  teacherIds: number[],
): Promise<Map<number, PublicQualifications>> {
  const out = new Map<number, PublicQualifications>();
  if (teacherIds.length === 0) return out;
  for (const id of teacherIds) out.set(id, { educations: [], scoutQualifications: [], trainings: [] });

  const [edu, scout, train] = await Promise.all([
    db
      .select()
      .from(teacherEducations)
      .where(inArray(teacherEducations.teacherId, teacherIds))
      .orderBy(asc(teacherEducations.sortOrder), asc(teacherEducations.id)),
    db
      .select()
      .from(teacherScoutQualifications)
      .where(inArray(teacherScoutQualifications.teacherId, teacherIds))
      .orderBy(asc(teacherScoutQualifications.sortOrder), asc(teacherScoutQualifications.id)),
    db
      .select()
      .from(teacherTrainings)
      .where(inArray(teacherTrainings.teacherId, teacherIds))
      .orderBy(asc(teacherTrainings.sortOrder), asc(teacherTrainings.id)),
  ]);

  for (const r of edu) {
    const { id, teacherId, sortOrder, ...rest } = r;
    out.get(teacherId)?.educations.push(rest);
  }
  for (const r of scout) {
    const { id, teacherId, sortOrder, ...rest } = r;
    out.get(teacherId)?.scoutQualifications.push(rest);
  }
  for (const r of train) {
    const { id, teacherId, sortOrder, ...rest } = r;
    out.get(teacherId)?.trainings.push(rest);
  }
  return out;
}

// -- the public API's teacher row ------------------------------------

/**
 * What /api/public/v1/teachers and ./[id] select, in one place so the list and
 * the by-id view publish the same fields. The contact block's columns ride
 * along in the select and are dropped by {@link shapePublicTeacher} unless the
 * caller asked for — and holds the scope for — `?include=contact`.
 */
export const PUBLIC_TEACHER_COLUMNS = {
  id: teachers.id,
  teacherCode: teachers.teacherCode,
  prefix: teachers.prefix,
  firstName: teachers.firstName,
  lastName: teachers.lastName,
  email: teachers.email,
  // Directory contact fields — plain `teachers:read`, like email.
  phone: teachers.phone,
  lineId: teachers.lineId,
  birthDate: teachers.birthDate,
  gender: teachers.gender,
  religion: teachers.religion,
  nationality: teachers.nationality,
  ethnicity: teachers.ethnicity,
  subjectGroup: teachers.subjectGroup,
  gradeTaught: teachers.gradeTaught,
  role: teachers.role,
  workStart: teachers.workStart,
  employmentStatus: teachers.employmentStatus,
  exitDate: teachers.exitDate,
  updatedAt: teachers.updatedAt,
  citizenIdEncrypted: teachers.citizenIdEncrypted,
  emergencyContactName: teachers.emergencyContactName,
  emergencyPhone: teachers.emergencyPhone,
  emergencyRelationship: teachers.emergencyRelationship,
  ...HOUSEHOLD_ADDRESS_COLUMNS,
};

interface PublicTeacherInput {
  id: number;
  prefix: string | null;
  firstName: string;
  lastName: string;
  hasPhoto: boolean;
  citizenIdEncrypted: string | null;
  emergencyContactName: string | null;
  emergencyPhone: string | null;
  emergencyRelationship: string | null;
}

/**
 * One selected row → the published object. เลขบัตร only with `:pii`; the
 * `contact` block (ผู้ติดต่อฉุกเฉิน + ที่อยู่ตามทะเบียนบ้าน) only when asked for.
 */
export function shapePublicTeacher<T extends PublicTeacherInput>(
  row: T,
  opts: { withPii: boolean; withContact: boolean },
) {
  const {
    citizenIdEncrypted,
    emergencyContactName,
    emergencyPhone,
    emergencyRelationship,
    ...rest
  } = row;
  const base = withoutAddressColumns(rest);
  return {
    ...base,
    fullName: `${row.prefix ?? ''}${row.firstName} ${row.lastName}`.trim(),
    photoUrl: row.hasPhoto ? `/api/public/v1/teachers/${row.id}/photo` : null,
    ...(opts.withPii ? { citizenId: tryDecrypt(citizenIdEncrypted) } : {}),
    ...(opts.withContact
      ? {
          contact: {
            emergencyContact: {
              name: emergencyContactName,
              phone: emergencyPhone,
              relationship: emergencyRelationship,
            },
            householdAddress: householdAddressOf(row),
          },
        }
      : {}),
  };
}

/** The empty answer, for a teacher with nothing on file. */
export function noQualifications(): PublicQualifications {
  return { educations: [], scoutQualifications: [], trainings: [] };
}

// -- what a teacher may change about themselves -----------------------

/**
 * The self-service allow-list. Everything else on a teacher row is admin-only,
 * and the split is by who the field belongs to rather than by how sensitive it
 * looks:
 *
 *  - Contact + demographics are the teacher's own facts, and they are the only
 *    person who knows when a phone number changes. They also carry no
 *    privilege, so a wrong value costs nothing but a wrong value.
 *  - The three qualification lists are the point of this feature: nobody but
 *    the holder has the certificates, and the office was re-typing them.
 *
 * LOCKED, and why each one:
 *  - teacherCode / role / permissions — the account itself. A teacher who could
 *    set their own role would be an admin.
 *  - email — it is a LOGIN identifier (api/auth/teacher-login accepts it in
 *    place of the code), so editing it is editing a credential.
 *  - ชื่อ-นามสกุล-คำนำหน้า — the registry identity these records exist to be.
 *    They do change (marriage, ยศ), but through the office that also has to
 *    change them on every official document, not here.
 *
 * วันเกิด, ผู้ติดต่อฉุกเฉิน, ที่อยู่ตามทะเบียนบ้าน and เดือน/ปีที่เข้าทำงาน were
 * opened to the teacher at the school's request (2026-09): the office did not
 * have them on file, and the teacher is the one holding the ทะเบียนบ้าน and the
 * คำสั่งบรรจุ. วันเกิด moved out of the locked list for the same reason.
 *  - เลขบัตร ปชช. — locked by DEFAULT, and the one lock the school can lift.
 *    With the sensitive switch on at /users/settings a teacher may reveal and
 *    correct their own; see SENSITIVE_EDITABLE. It is not in the everyday list
 *    because it is encrypted at rest, so a typo is invisible once saved, and
 *    because every reveal of it is worth an audit row of its own.
 *  - กลุ่มสาระ / ชั้นที่สอน — an assignment the school makes, not a fact about
 *    the person.
 *  - employmentStatus / exit* / isArchived — the lifecycle. Nobody resigns
 *    themselves out of a database.
 *
 * Password is not in this list, and a teacher cannot change it at all: the
 * school hands out and resets staff passwords itself (see api/users/me/password).
 */
export const SELF_EDITABLE = [
  'phone',
  'lineId',
  'birthDate',
  'gender',
  'religion',
  'nationality',
  'ethnicity',
  'emergencyContactName',
  'emergencyPhone',
  'emergencyRelationship',
  'householdAddress',
  'workStart',
] as const;

export type SelfEditableField = (typeof SELF_EDITABLE)[number];

/**
 * The extra field the school-wide sensitive switch unlocks. Kept apart from
 * SELF_EDITABLE because a different switch governs it: the page must be able to
 * grey this one while the rest stay editable, and the /me route reports the two
 * lists separately for exactly that reason.
 */
export const SENSITIVE_EDITABLE = ['citizenId'] as const;

/** The scalar half of a self-service PATCH — nothing outside SELF_EDITABLE. */
export const selfPatchSchema = teacherProfileFieldsSchema
  .extend({
    // Accepted only when the sensitive switch is on; api/users/me refuses the
    // whole request before it reaches here if it is not. '' clears the field.
    citizenId: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || v.trim() === '' || isValidCitizenId(v), {
        message: 'เลขบัตรประชาชนไม่ถูกต้อง (ต้องเป็น 13 หลักและผ่านการตรวจหลักสุดท้าย)',
      }),
  })
  .merge(teacherListsSchema)
  // A payload naming a locked field is a bug or an attempt; either way it is
  // refused loudly rather than silently dropped, so the UI cannot quietly
  // "save" a change that never happened.
  .strict();

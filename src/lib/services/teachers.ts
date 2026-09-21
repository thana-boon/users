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
    ...core,
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
 *  - ชื่อ-นามสกุล-คำนำหน้า, วันเกิด, เลขบัตร ปชช. — the registry identity these
 *    records exist to be. They do change (marriage, ยศ), but through the office
 *    that also has to change them on every official document, not here.
 *  - กลุ่มสาระ / ชั้นที่สอน — an assignment the school makes, not a fact about
 *    the person.
 *  - employmentStatus / exit* / isArchived — the lifecycle. Nobody resigns
 *    themselves out of a database.
 *
 * Password is not in this list because it is not a column edit: changing it
 * requires proving the current one (see api/users/me/password).
 */
export const SELF_EDITABLE = [
  'phone',
  'lineId',
  'gender',
  'religion',
  'nationality',
  'ethnicity',
] as const;

export type SelfEditableField = (typeof SELF_EDITABLE)[number];

/** The scalar half of a self-service PATCH — nothing outside SELF_EDITABLE. */
export const selfPatchSchema = z
  .object({
    phone: nstr,
    lineId: nstr,
    gender: nstr,
    religion: nstr,
    nationality: nstr,
    ethnicity: nstr,
  })
  .merge(teacherListsSchema)
  // A payload naming a locked field is a bug or an attempt; either way it is
  // refused loudly rather than silently dropped, so the UI cannot quietly
  // "save" a change that never happened.
  .strict();

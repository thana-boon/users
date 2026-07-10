import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import {
  students,
  enrollments,
  studentAddresses,
  guardians,
  previousSchools,
  studentHealth,
  academicYears,
  completions,
} from '@/db/schema';
import { encrypt } from '@/lib/crypto';
import { keyStageOf } from '@/lib/grades';
import type { ParsedStudent } from '@/lib/excel-map';
import type { StudentStatus } from '@/db/schema';

/**
 * Insert or update a full student aggregate (identity + enrollment for the
 * given year + addresses + guardians + previous school + health) inside one
 * transaction. Sensitive fields are encrypted here. Idempotent on student_code.
 *
 * Returns { studentId, created }.
 */
export async function upsertStudentFull(
  parsed: ParsedStudent,
  academicYearId: number,
): Promise<{ studentId: number; created: boolean }> {
  return db.transaction(async (tx) => {
    const c = parsed.core;
    const existing = await tx.query.students.findFirst({
      where: eq(students.studentCode, c.studentCode),
      columns: { id: true },
    });

    const coreValues = {
      studentCode: c.studentCode,
      citizenIdEncrypted: encrypt(c.citizenId),
      role: 'student' as const,
      prefix: c.prefix,
      firstName: c.firstName,
      lastName: c.lastName,
      nickname: c.nickname,
      firstNameEn: c.firstNameEn,
      lastNameEn: c.lastNameEn,
      nicknameEn: c.nicknameEn,
      gender: c.gender,
      birthDate: c.birthDate,
      religion: c.religion,
      nationality: c.nationality,
      ethnicity: c.ethnicity,
      siblingsTotal: c.siblingsTotal,
      siblingOrder: c.siblingOrder,
      hasSiblingInSchool: c.hasSiblingInSchool,
      phone: c.phone,
      email: c.email,
      passwordEncrypted: encrypt(c.plainPassword),
      admissionDate: c.admissionDate,
    };

    let studentId: number;
    let created: boolean;
    if (existing) {
      studentId = existing.id;
      created = false;
      await tx.update(students).set(coreValues).where(eq(students.id, studentId));
    } else {
      const [row] = await tx
        .insert(students)
        .values(coreValues)
        .returning({ id: students.id });
      studentId = row.id;
      created = true;
    }

    // Enrollment for this academic year (upsert on unique(student, year)).
    await tx
      .insert(enrollments)
      .values({
        studentId,
        academicYearId,
        gradeLevel: parsed.enrollment.gradeLevel,
        classroom: parsed.enrollment.classroom,
        classNumber: parsed.enrollment.classNumber,
        seqOrder: parsed.enrollment.seqOrder,
      })
      .onConflictDoUpdate({
        target: [enrollments.studentId, enrollments.academicYearId],
        set: {
          gradeLevel: parsed.enrollment.gradeLevel,
          classroom: parsed.enrollment.classroom,
          classNumber: parsed.enrollment.classNumber,
          seqOrder: parsed.enrollment.seqOrder,
        },
      });

    // Replace child collections (simplest correct upsert for import).
    await tx.delete(studentAddresses).where(eq(studentAddresses.studentId, studentId));
    if (parsed.addresses.length) {
      await tx.insert(studentAddresses).values(
        parsed.addresses.map((a) => ({
          studentId,
          addressType: a.addressType as 'household' | 'birth_place' | 'current' | 'hometown',
          houseNo: a.houseNo ?? null,
          moo: a.moo ?? null,
          soi: a.soi ?? null,
          road: a.road ?? null,
          subDistrict: a.subDistrict ?? null,
          district: a.district ?? null,
          province: a.province ?? null,
          postalCode: a.postalCode ?? null,
          phone: a.phone ?? null,
          houseRegCode: a.houseRegCode ?? null,
          hospitalName: a.hospitalName ?? null,
          livingWith: a.livingWith ?? null,
          livingWithLastname: a.livingWithLastname ?? null,
          houseType: a.houseType ?? null,
          emergencyEmail: a.emergencyEmail ?? null,
          emergencyPhone: a.emergencyPhone ?? null,
          nearbyFriendName: a.nearbyFriendName ?? null,
          nearbyFriendLastname: a.nearbyFriendLastname ?? null,
          nearbyFriendPhone: a.nearbyFriendPhone ?? null,
        })),
      );
    }

    await tx.delete(guardians).where(eq(guardians.studentId, studentId));
    if (parsed.guardians.length) {
      await tx.insert(guardians).values(
        parsed.guardians.map((gd) => ({
          studentId,
          guardianType: gd.guardianType as 'guardian' | 'father' | 'mother',
          relationship: gd.relationship ?? null,
          citizenIdEncrypted: encrypt(gd.citizenId ?? null),
          prefix: gd.prefix ?? null,
          firstName: gd.firstName ?? null,
          lastName: gd.lastName ?? null,
          firstNameEn: gd.firstNameEn ?? null,
          lastNameEn: gd.lastNameEn ?? null,
          birthDate: gd.birthDate ?? null,
          religion: gd.religion ?? null,
          nationality: gd.nationality ?? null,
          ethnicity: gd.ethnicity ?? null,
          houseNo: gd.houseNo ?? null,
          moo: gd.moo ?? null,
          soi: gd.soi ?? null,
          road: gd.road ?? null,
          subDistrict: gd.subDistrict ?? null,
          district: gd.district ?? null,
          province: gd.province ?? null,
          postalCode: gd.postalCode ?? null,
          homePhone: gd.homePhone ?? null,
          mobilePhone: gd.mobilePhone ?? null,
          workPhone: gd.workPhone ?? null,
          familyStatus: gd.familyStatus ?? null,
          education: gd.education ?? null,
          occupation: gd.occupation ?? null,
          workplace: gd.workplace ?? null,
          incomeMonthlyEncrypted: encrypt(gd.incomeMonthly ?? null),
          incomeYearlyEncrypted: encrypt(gd.incomeYearly ?? null),
        })),
      );
    }

    await tx.delete(previousSchools).where(eq(previousSchools.studentId, studentId));
    if (parsed.previousSchool) {
      const p = parsed.previousSchool;
      await tx.insert(previousSchools).values({
        studentId,
        schoolName: p.schoolName ?? null,
        subDistrict: p.subDistrict ?? null,
        district: p.district ?? null,
        province: p.province ?? null,
        qualification: p.qualification ?? null,
        gpa: p.gpa ?? null,
        transferReason: p.transferReason ?? null,
      });
    }

    await tx.delete(studentHealth).where(eq(studentHealth.studentId, studentId));
    if (parsed.health) {
      const h = parsed.health;
      await tx.insert(studentHealth).values({
        studentId,
        weight: h.weight ?? null,
        height: h.height ?? null,
        bloodType: h.bloodType ?? null,
        foodAllergy: h.foodAllergy ?? null,
        drugAllergy: h.drugAllergy ?? null,
        otherAllergy: h.otherAllergy ?? null,
        chronicDisease: h.chronicDisease ?? null,
        seriousDisease: h.seriousDisease ?? null,
      });
    }

    return { studentId, created };
  });
}

/** '' / undefined -> null; otherwise trimmed string. */
function norm(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export interface StudentUpdateInput {
  // identity
  prefix?: string | null; firstName?: string; lastName?: string;
  nickname?: string | null; firstNameEn?: string | null; lastNameEn?: string | null;
  nicknameEn?: string | null; gender?: string | null; birthDate?: string | null;
  religion?: string | null; nationality?: string | null; ethnicity?: string | null;
  phone?: string | null; email?: string | null; admissionDate?: string | null;
  // sensitive — only applied when a non-empty value is supplied (blank = keep)
  citizenId?: string | null; password?: string | null;
  // active-year enrollment (or a specific enrollment by id)
  enrollment?: { id?: number; gradeLevel?: string | null; classroom?: string | null; classNumber?: string | null };
  health?: Record<string, string | null | undefined>;
  previousSchool?: Record<string, string | null | undefined>;
  addresses?: Array<Record<string, string | null | undefined> & { addressType: string }>;
  guardians?: Array<Record<string, string | null | undefined> & { guardianType: string }>;
}

const IDENTITY_FIELDS = [
  'prefix', 'firstName', 'lastName', 'nickname', 'firstNameEn', 'lastNameEn', 'nicknameEn',
  'gender', 'birthDate', 'religion', 'nationality', 'ethnicity', 'phone', 'email', 'admissionDate',
] as const;

const ADDRESS_FIELDS = [
  'houseNo', 'moo', 'soi', 'road', 'subDistrict', 'district', 'province', 'postalCode', 'phone',
  'houseRegCode', 'hospitalName', 'livingWith', 'livingWithLastname', 'houseType',
  'emergencyEmail', 'emergencyPhone', 'nearbyFriendName', 'nearbyFriendLastname', 'nearbyFriendPhone',
] as const;

const GUARDIAN_FIELDS = [
  'relationship', 'prefix', 'firstName', 'lastName', 'firstNameEn', 'lastNameEn', 'birthDate',
  'religion', 'nationality', 'ethnicity', 'houseNo', 'moo', 'soi', 'road', 'subDistrict',
  'district', 'province', 'postalCode', 'homePhone', 'mobilePhone', 'workPhone',
  'familyStatus', 'education', 'occupation', 'workplace',
] as const;

const HEALTH_FIELDS = [
  'weight', 'height', 'bloodType', 'foodAllergy', 'drugAllergy', 'otherAllergy',
  'chronicDisease', 'seriousDisease',
] as const;

const PREV_SCHOOL_FIELDS = [
  'schoolName', 'subDistrict', 'district', 'province', 'qualification', 'gpa', 'transferReason',
] as const;

/**
 * Full edit: updates identity + the active-year enrollment + all child sections
 * (addresses, guardians, health, previous school) in one transaction. Child
 * collections upsert by their natural type key so partial edits are safe.
 * Encrypted fields (citizen id / password / income) are only rewritten when a
 * non-empty plaintext is supplied — blank means "leave as-is".
 */
export async function updateStudentAggregate(id: number, data: StudentUpdateInput): Promise<void> {
  await db.transaction(async (tx) => {
    // -- identity --
    const coreSet: Record<string, unknown> = {};
    for (const k of IDENTITY_FIELDS) {
      if (data[k] !== undefined) coreSet[k] = norm(data[k]);
    }
    if (data.citizenId) coreSet.citizenIdEncrypted = encrypt(data.citizenId);
    if (data.password) coreSet.passwordEncrypted = encrypt(data.password);
    if (Object.keys(coreSet).length) {
      await tx.update(students).set(coreSet).where(eq(students.id, id));
    }

    // -- enrollment (specific id, else most recent) --
    if (data.enrollment) {
      const e = data.enrollment;
      const set = {
        gradeLevel: norm(e.gradeLevel),
        classroom: norm(e.classroom),
        classNumber: norm(e.classNumber),
      };
      if (e.id) {
        await tx.update(enrollments).set(set)
          .where(and(eq(enrollments.id, e.id), eq(enrollments.studentId, id)));
      } else {
        const cur = await tx.query.enrollments.findFirst({
          where: eq(enrollments.studentId, id),
          orderBy: (t, { desc }) => desc(t.academicYearId),
        });
        if (cur) await tx.update(enrollments).set(set).where(eq(enrollments.id, cur.id));
      }
    }

    // -- health (1:1 upsert) --
    if (data.health) {
      const vals: Record<string, string | null> = {};
      for (const k of HEALTH_FIELDS) vals[k] = norm(data.health[k]);
      await tx.insert(studentHealth).values({ studentId: id, ...vals })
        .onConflictDoUpdate({ target: studentHealth.studentId, set: vals });
    }

    // -- previous school (replace) --
    if (data.previousSchool) {
      const vals: Record<string, string | null> = {};
      for (const k of PREV_SCHOOL_FIELDS) vals[k] = norm(data.previousSchool[k]);
      await tx.delete(previousSchools).where(eq(previousSchools.studentId, id));
      await tx.insert(previousSchools).values({ studentId: id, ...vals });
    }

    // -- addresses (upsert per type) --
    if (data.addresses) {
      for (const a of data.addresses) {
        if (!a.addressType) continue;
        const vals: Record<string, string | null> = {};
        for (const k of ADDRESS_FIELDS) vals[k] = norm(a[k]);
        await tx.insert(studentAddresses)
          .values({ studentId: id, addressType: a.addressType as 'household' | 'birth_place' | 'current' | 'hometown', ...vals })
          .onConflictDoUpdate({
            target: [studentAddresses.studentId, studentAddresses.addressType],
            set: vals,
          });
      }
    }

    // -- guardians (upsert per type; encrypted fields optional) --
    if (data.guardians) {
      for (const g of data.guardians) {
        if (!g.guardianType) continue;
        const vals: Record<string, unknown> = {};
        for (const k of GUARDIAN_FIELDS) vals[k] = norm(g[k]);
        if (g.citizenId) vals.citizenIdEncrypted = encrypt(g.citizenId);
        if (g.incomeMonthly) vals.incomeMonthlyEncrypted = encrypt(g.incomeMonthly);
        if (g.incomeYearly) vals.incomeYearlyEncrypted = encrypt(g.incomeYearly);
        await tx.insert(guardians)
          .values({ studentId: id, guardianType: g.guardianType as 'guardian' | 'father' | 'mother', ...vals })
          .onConflictDoUpdate({
            target: [guardians.studentId, guardians.guardianType],
            set: vals,
          });
      }
    }
  });
}

export interface SetStatusInput {
  status: 'studying' | 'withdrawn' | 'graduated';
  exitType?: string | null;
  exitReason?: string | null;
  exitDate?: string | null;
  /** Academic year the exit belongs to (anchors the history views). */
  academicYearId?: number | null;
  /** Optionally record a จบช่วงชั้น milestone (e.g. on graduation). */
  completion?: {
    keyStage: 'kindergarten' | 'primary' | 'lower_secondary' | 'upper_secondary';
    gradeLevel?: string | null;
    academicYearId?: number | null;
    completionDate?: string | null;
  } | null;
}

/**
 * Set a student's lifecycle status. `withdrawn`/`graduated` store the exit
 * date + reason (fed to the future document API); `studying` (reinstate) clears
 * them. Optionally records a key-stage completion milestone in the same tx.
 */
export async function setStudentStatus(id: number, input: SetStatusInput): Promise<void> {
  await db.transaction(async (tx) => {
    if (input.status === 'studying') {
      await tx
        .update(students)
        .set({ status: 'studying', exitType: null, exitReason: null, exitDate: null, exitAcademicYearId: null })
        .where(eq(students.id, id));
    } else {
      await tx
        .update(students)
        .set({
          status: input.status,
          exitType: norm(input.exitType),
          exitReason: norm(input.exitReason),
          exitDate: norm(input.exitDate),
          exitAcademicYearId: input.academicYearId ?? null,
        })
        .where(eq(students.id, id));
    }

    if (input.completion) {
      const c = input.completion;
      await tx
        .insert(completions)
        .values({
          studentId: id,
          keyStage: c.keyStage,
          gradeLevel: norm(c.gradeLevel),
          academicYearId: c.academicYearId ?? null,
          completionDate: norm(c.completionDate),
        })
        .onConflictDoNothing({ target: [completions.studentId, completions.keyStage] });
    }
  });
}

export interface BulkStatusInput {
  studentIds: number[];
  status: 'withdrawn' | 'graduated';
  exitType?: string | null;
  exitReason?: string | null;
  exitDate?: string | null;
  /** The roster year the batch was run on — stored as the exit year. */
  academicYearId: number;
  /**
   * On graduation, also record a จบช่วงชั้น milestone for each student, using
   * their grade in `academicYearId` to pick the key stage.
   */
  recordCompletion?: boolean;
}

/**
 * Set the lifecycle status (withdrawn/graduated) for a batch of students in one
 * transaction — e.g. graduate a whole ม.6 cohort, or จำหน่าย a group. Stores the
 * exit metadata + exit year on each student; on graduation optionally records a
 * key-stage completion milestone (derived from the student's grade that year).
 */
export async function bulkSetStudentStatus(
  input: BulkStatusInput,
): Promise<{ updated: number; completionsRecorded: number }> {
  const ids = [...new Set(input.studentIds)].filter((n) => Number.isFinite(n));
  if (!ids.length) return { updated: 0, completionsRecorded: 0 };

  return db.transaction(async (tx) => {
    await tx
      .update(students)
      .set({
        status: input.status,
        exitType: norm(input.exitType),
        exitReason: norm(input.exitReason),
        exitDate: norm(input.exitDate),
        exitAcademicYearId: input.academicYearId,
      })
      .where(inArray(students.id, ids));

    let completionsRecorded = 0;
    if (input.recordCompletion) {
      // Grade per student that year → key stage for the milestone.
      const enr = await tx
        .select({ studentId: enrollments.studentId, gradeLevel: enrollments.gradeLevel })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.academicYearId, input.academicYearId),
            inArray(enrollments.studentId, ids),
          ),
        );
      for (const e of enr) {
        const stage = keyStageOf(e.gradeLevel);
        if (!stage) continue;
        const res = await tx
          .insert(completions)
          .values({
            studentId: e.studentId,
            academicYearId: input.academicYearId,
            keyStage: stage,
            gradeLevel: e.gradeLevel,
            completionDate: norm(input.exitDate),
          })
          .onConflictDoNothing({ target: [completions.studentId, completions.keyStage] })
          .returning({ id: completions.id });
        completionsRecorded += res.length;
      }
    }

    return { updated: ids.length, completionsRecorded };
  });
}

/**
 * Reinstate a batch of students to กำลังศึกษา in one statement — e.g. undo a
 * whole graduation ชุด. Clears the exit metadata + exit year. Returns the number
 * of rows targeted. (Key-stage completion milestones are left untouched, matching
 * the single-student reinstate.)
 */
export async function bulkReinstateStudents(studentIds: number[]): Promise<number> {
  const ids = [...new Set(studentIds)].filter((n) => Number.isFinite(n));
  if (!ids.length) return 0;
  await db
    .update(students)
    .set({ status: 'studying', exitType: null, exitReason: null, exitDate: null, exitAcademicYearId: null })
    .where(inArray(students.id, ids));
  return ids.length;
}

export interface ExitHistoryRow {
  id: number;
  studentCode: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  gender: string | null;
  exitType: string | null;
  exitReason: string | null;
  exitDate: string | null;
  exitYear: number | null;
  gradeLevel: string | null; // grade in the exit year
  classroom: string | null;
}

/**
 * History of students who left with the given status (withdrawn/graduated),
 * newest exit year first. Joins the exit-year academic year (for the grouping
 * year) and the student's enrollment in that year (for the grade they left at).
 */
export async function listExitHistory(status: StudentStatus): Promise<ExitHistoryRow[]> {
  const exitYear = alias(academicYears, 'exit_year');
  const exitEnr = alias(enrollments, 'exit_enr');
  const rows = await db
    .select({
      id: students.id,
      studentCode: students.studentCode,
      prefix: students.prefix,
      firstName: students.firstName,
      lastName: students.lastName,
      gender: students.gender,
      exitType: students.exitType,
      exitReason: students.exitReason,
      exitDate: students.exitDate,
      exitYear: exitYear.year,
      gradeLevel: exitEnr.gradeLevel,
      classroom: exitEnr.classroom,
    })
    .from(students)
    .leftJoin(exitYear, eq(exitYear.id, students.exitAcademicYearId))
    .leftJoin(
      exitEnr,
      and(
        eq(exitEnr.studentId, students.id),
        eq(exitEnr.academicYearId, students.exitAcademicYearId),
      ),
    )
    .where(and(eq(students.status, status), eq(students.isArchived, false)))
    .orderBy(desc(exitYear.year), asc(students.studentCode));
  return rows;
}

/** Resolve the active academic year id, or the newest, creating 2569 if none. */
export async function resolveActiveYearId(): Promise<number> {
  const active = await db.query.academicYears.findFirst({
    where: eq(academicYears.isActive, true),
  });
  if (active) return active.id;
  const any = await db.query.academicYears.findFirst({
    orderBy: (y, { desc }) => desc(y.year),
  });
  if (any) return any.id;
  const [row] = await db
    .insert(academicYears)
    .values({ year: 2569, isActive: true })
    .returning({ id: academicYears.id });
  return row.id;
}

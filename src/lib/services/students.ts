import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  students,
  enrollments,
  studentAddresses,
  guardians,
  previousSchools,
  studentHealth,
  academicYears,
} from '@/db/schema';
import { encrypt } from '@/lib/crypto';
import type { ParsedStudent } from '@/lib/excel-map';

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

import {
  pgTable,
  pgEnum,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * SchoolOS - Student & Teacher Records schema (PostgreSQL / database "users").
 *
 * Normalization: identity data (name, born, who's-who) lives once in `students`;
 * grade/classroom lives per academic year in `enrollments`. A student the site
 * shows for a given year = JOIN students + enrollments WHERE academic_year_id = ?.
 *
 * Sensitive fields (citizen_id, password_encrypted, income_*) are stored as
 * AES-256-GCM ciphertext (see src/lib/crypto.ts). The encryption key lives
 * outside the DB (env). Columns holding ciphertext are named `*_encrypted`.
 */

// -- Enums (shared role model across the system) --------------------
export const STUDENT_ROLES = ['student', 'teacher', 'teacher-admin'] as const;
export const TEACHER_ROLES = ['teacher', 'teacher-admin'] as const;
export const ADDRESS_TYPES = ['household', 'birth_place', 'current', 'hometown'] as const;
export const GUARDIAN_TYPES = ['guardian', 'father', 'mother'] as const;

// Person-level lifecycle status. `studying` = active on the school roll;
// `withdrawn` = ลาออก/จำหน่าย mid-way (needs exitDate + exitReason); `graduated`
// = finished the school's top grade and left. Crossing a key-stage boundary
// INSIDE the same school (ป.6→ม.1) is NOT an exit — it stays `studying` and is
// recorded as a `completions` milestone instead. See src/lib/grades.ts.
export const STUDENT_STATUSES = ['studying', 'withdrawn', 'graduated'] as const;
// ช่วงชั้น — used by the key-stage completion milestone (for future document API).
export const KEY_STAGES = ['kindergarten', 'primary', 'lower_secondary', 'upper_secondary'] as const;

export const studentRoleEnum = pgEnum('student_role', STUDENT_ROLES);
export const teacherRoleEnum = pgEnum('teacher_role', TEACHER_ROLES);
export const addressTypeEnum = pgEnum('address_type', ADDRESS_TYPES);
export const guardianTypeEnum = pgEnum('guardian_type', GUARDIAN_TYPES);
export const studentStatusEnum = pgEnum('student_status', STUDENT_STATUSES);
export const keyStageEnum = pgEnum('key_stage', KEY_STAGES);

const now = () => new Date();

// -- academic_years -------------------------------------------------
export const academicYears = pgTable(
  'academic_years',
  {
    id: serial('id').primaryKey(),
    year: integer('year').notNull(), // Thai Buddhist year, e.g. 2569
    startDate: varchar('start_date', { length: 10 }), // ISO yyyy-mm-dd
    endDate: varchar('end_date', { length: 10 }),
    isActive: boolean('is_active').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(now),
  },
  (t) => ({
    yearUniq: unique('academic_years_year_uniq').on(t.year),
  }),
);

// -- students (identity, deduplicated per person) -------------------
export const students = pgTable(
  'students',
  {
    id: serial('id').primaryKey(),
    studentCode: varchar('student_code', { length: 32 }).notNull(),
    // encrypted (เลขบัตร ปชช.)
    citizenIdEncrypted: text('citizen_id_encrypted'),
    role: studentRoleEnum('role').notNull().default('student'),

    prefix: varchar('prefix', { length: 32 }),
    firstName: varchar('first_name', { length: 128 }).notNull(),
    lastName: varchar('last_name', { length: 128 }).notNull(),
    nickname: varchar('nickname', { length: 64 }),
    firstNameEn: varchar('first_name_en', { length: 128 }),
    lastNameEn: varchar('last_name_en', { length: 128 }),
    nicknameEn: varchar('nickname_en', { length: 64 }),

    gender: varchar('gender', { length: 16 }),
    birthDate: varchar('birth_date', { length: 20 }), // raw Thai dd/mm/BBBB
    religion: varchar('religion', { length: 48 }),
    nationality: varchar('nationality', { length: 48 }),
    ethnicity: varchar('ethnicity', { length: 48 }),

    siblingsTotal: integer('siblings_total'),
    siblingOrder: integer('sibling_order'),
    hasSiblingInSchool: varchar('has_sibling_in_school', { length: 16 }),

    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 128 }),
    // encrypted plaintext password (reversible; admin can reveal - see audit_logs)
    passwordEncrypted: text('password_encrypted'),
    admissionDate: varchar('admission_date', { length: 20 }),

    // Profile photo stored inline (base64) so it travels with the DB backup and
    // needs no writable volume on the standalone Docker image. Served via the
    // audited /api/users/students/[id]/photo route, never in list payloads.
    photoBase64: text('photo_base64'),
    photoMime: varchar('photo_mime', { length: 32 }),

    // Lifecycle status (see STUDENT_STATUSES). Exit fields feed the future
    // document-export API (ลาออก/จำหน่าย/จบการศึกษา).
    status: studentStatusEnum('status').notNull().default('studying'),
    exitType: varchar('exit_type', { length: 32 }), // ลาออก | จำหน่าย | ย้ายสถานศึกษา | จบการศึกษา ...
    exitReason: text('exit_reason'),
    exitDate: varchar('exit_date', { length: 20 }), // raw Thai dd/mm/BBBB
    // Academic year in which the student graduated/withdrew. Anchors the exit
    // history views (which cohort left in which year) without parsing exitDate.
    exitAcademicYearId: integer('exit_academic_year_id').references(() => academicYears.id),

    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(now),
  },
  (t) => ({
    codeUniq: unique('students_code_uniq').on(t.studentCode),
    emailIdx: index('students_email_idx').on(t.email),
    nameIdx: index('students_name_idx').on(t.firstName, t.lastName),
  }),
);

// -- enrollments (grade/room per academic year) ---------------------
export const enrollments = pgTable(
  'enrollments',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    academicYearId: integer('academic_year_id')
      .notNull()
      .references(() => academicYears.id),
    gradeLevel: varchar('grade_level', { length: 32 }), // ชั้น เช่น ป.1
    classroom: varchar('classroom', { length: 16 }), // ห้อง
    classNumber: varchar('class_number', { length: 16 }), // เลขที่
    seqOrder: integer('seq_order'), // ลำดับ
    updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(now),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // 1 student : 1 enrollment per academic year
    studentYearUniq: unique('enrollments_student_year_uniq').on(
      t.studentId,
      t.academicYearId,
    ),
    yearIdx: index('enrollments_year_idx').on(t.academicYearId),
    gradeIdx: index('enrollments_grade_idx').on(t.academicYearId, t.gradeLevel),
  }),
);

// -- completions (จบช่วงชั้น milestone) -----------------------------
// One row per (student, key stage) the student has completed — even while they
// keep studying at the same school. Lets the future document-export API issue
// "สำเร็จการศึกษาระดับประถม/ม.ต้น/ม.ปลาย" (ปพ.) without conflating it with an
// exit. Written automatically when a promotion crosses a key-stage boundary.
export const completions = pgTable(
  'completions',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    // The academic year in which the stage was completed (the source year).
    academicYearId: integer('academic_year_id').references(() => academicYears.id),
    keyStage: keyStageEnum('key_stage').notNull(),
    gradeLevel: varchar('grade_level', { length: 32 }), // ชั้นที่จบ เช่น ป.6
    completionDate: varchar('completion_date', { length: 20 }), // raw Thai dd/mm/BBBB
    gpa: varchar('gpa', { length: 16 }),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    studentStageUniq: unique('completions_student_stage_uniq').on(
      t.studentId,
      t.keyStage,
    ),
    studentIdx: index('completions_student_idx').on(t.studentId),
  }),
);

// -- student_addresses (4 types per student) ------------------------
export const studentAddresses = pgTable(
  'student_addresses',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    addressType: addressTypeEnum('address_type').notNull(),

    houseNo: varchar('house_no', { length: 64 }),
    moo: varchar('moo', { length: 32 }),
    soi: varchar('soi', { length: 128 }),
    road: varchar('road', { length: 128 }),
    subDistrict: varchar('sub_district', { length: 128 }),
    district: varchar('district', { length: 128 }),
    province: varchar('province', { length: 128 }),
    postalCode: varchar('postal_code', { length: 16 }),
    phone: varchar('phone', { length: 32 }),
    houseRegCode: varchar('house_reg_code', { length: 32 }), // รหัสประจำบ้าน

    // birth_place only
    hospitalName: varchar('hospital_name', { length: 191 }),

    // current only
    livingWith: varchar('living_with', { length: 128 }),
    livingWithLastname: varchar('living_with_lastname', { length: 128 }),
    houseType: varchar('house_type', { length: 64 }),
    emergencyEmail: varchar('emergency_email', { length: 128 }),
    emergencyPhone: varchar('emergency_phone', { length: 32 }),
    nearbyFriendName: varchar('nearby_friend_name', { length: 128 }),
    nearbyFriendLastname: varchar('nearby_friend_lastname', { length: 128 }),
    nearbyFriendPhone: varchar('nearby_friend_phone', { length: 32 }),
  },
  (t) => ({
    studentTypeUniq: unique('student_addresses_student_type_uniq').on(
      t.studentId,
      t.addressType,
    ),
  }),
);

// -- previous_schools ----------------------------------------------
export const previousSchools = pgTable('previous_schools', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  schoolName: varchar('school_name', { length: 191 }),
  subDistrict: varchar('sub_district', { length: 128 }),
  district: varchar('district', { length: 128 }),
  province: varchar('province', { length: 128 }),
  qualification: varchar('qualification', { length: 128 }),
  gpa: varchar('gpa', { length: 16 }),
  transferReason: text('transfer_reason'),
});

// -- guardians (guardian / father / mother) ------------------------
export const guardians = pgTable(
  'guardians',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    guardianType: guardianTypeEnum('guardian_type').notNull(),
    relationship: varchar('relationship', { length: 64 }), // guardian type only

    // encrypted (เลขบัตรประชาชน)
    citizenIdEncrypted: text('citizen_id_encrypted'),

    prefix: varchar('prefix', { length: 32 }),
    firstName: varchar('first_name', { length: 128 }),
    lastName: varchar('last_name', { length: 128 }),
    firstNameEn: varchar('first_name_en', { length: 128 }),
    lastNameEn: varchar('last_name_en', { length: 128 }),
    birthDate: varchar('birth_date', { length: 20 }),
    religion: varchar('religion', { length: 48 }),
    nationality: varchar('nationality', { length: 48 }),
    ethnicity: varchar('ethnicity', { length: 48 }),

    houseNo: varchar('house_no', { length: 64 }),
    moo: varchar('moo', { length: 32 }),
    soi: varchar('soi', { length: 128 }),
    road: varchar('road', { length: 128 }),
    subDistrict: varchar('sub_district', { length: 128 }),
    district: varchar('district', { length: 128 }),
    province: varchar('province', { length: 128 }),
    postalCode: varchar('postal_code', { length: 16 }),

    homePhone: varchar('home_phone', { length: 32 }),
    mobilePhone: varchar('mobile_phone', { length: 32 }),
    workPhone: varchar('work_phone', { length: 32 }),

    familyStatus: varchar('family_status', { length: 64 }), // guardian type only
    education: varchar('education', { length: 128 }),
    occupation: varchar('occupation', { length: 128 }),
    workplace: varchar('workplace', { length: 191 }),
    // encrypted (income = sensitive under PDPA)
    incomeMonthlyEncrypted: text('income_monthly_encrypted'),
    incomeYearlyEncrypted: text('income_yearly_encrypted'),
  },
  (t) => ({
    studentTypeUniq: unique('guardians_student_type_uniq').on(
      t.studentId,
      t.guardianType,
    ),
  }),
);

// -- student_health -------------------------------------------------
export const studentHealth = pgTable('student_health', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' })
    .unique(),
  weight: varchar('weight', { length: 16 }),
  height: varchar('height', { length: 16 }),
  bloodType: varchar('blood_type', { length: 8 }),
  foodAllergy: varchar('food_allergy', { length: 191 }),
  drugAllergy: varchar('drug_allergy', { length: 191 }),
  otherAllergy: varchar('other_allergy', { length: 191 }),
  chronicDisease: varchar('chronic_disease', { length: 191 }),
  seriousDisease: varchar('serious_disease', { length: 191 }),
});

// -- teachers -------------------------------------------------------
export const teachers = pgTable(
  'teachers',
  {
    id: serial('id').primaryKey(),
    teacherCode: varchar('teacher_code', { length: 32 }).notNull(), // login id, e.g. T00005
    citizenIdEncrypted: text('citizen_id_encrypted'), // nullable - often blank in source
    role: teacherRoleEnum('role').notNull().default('teacher'),

    prefix: varchar('prefix', { length: 32 }),
    firstName: varchar('first_name', { length: 128 }).notNull(),
    lastName: varchar('last_name', { length: 128 }).notNull(),
    email: varchar('email', { length: 128 }),
    subjectGroup: varchar('subject_group', { length: 191 }), // กลุ่มสาระที่สอน
    gradeTaught: varchar('grade_taught', { length: 128 }), // ชั้นที่สอน
    passwordEncrypted: text('password_encrypted'),

    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(now),
  },
  (t) => ({
    codeUniq: unique('teachers_code_uniq').on(t.teacherCode),
    emailIdx: index('teachers_email_idx').on(t.email),
  }),
);

// -- audit_logs (who viewed/changed sensitive data & passwords) ----
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id'), // teacher.id performing the action
    actorRole: varchar('actor_role', { length: 32 }),
    actorLabel: varchar('actor_label', { length: 128 }),
    action: varchar('action', { length: 64 }).notNull(), // e.g. reveal_password, update, delete
    targetType: varchar('target_type', { length: 32 }).notNull(), // student | teacher | ...
    targetId: integer('target_id'),
    targetLabel: varchar('target_label', { length: 191 }), // whose password / record
    detail: text('detail'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    targetIdx: index('audit_target_idx').on(t.targetType, t.targetId),
    actionIdx: index('audit_action_idx').on(t.action),
    createdIdx: index('audit_created_idx').on(t.createdAt),
  }),
);

// -- relations ------------------------------------------------------
export const studentsRelations = relations(students, ({ many, one }) => ({
  enrollments: many(enrollments),
  addresses: many(studentAddresses),
  previousSchool: one(previousSchools),
  guardians: many(guardians),
  health: one(studentHealth),
  completions: many(completions),
}));

export const completionsRelations = relations(completions, ({ one }) => ({
  student: one(students, {
    fields: [completions.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [completions.academicYearId],
    references: [academicYears.id],
  }),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(students, {
    fields: [enrollments.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [enrollments.academicYearId],
    references: [academicYears.id],
  }),
}));

export const academicYearsRelations = relations(academicYears, ({ many }) => ({
  enrollments: many(enrollments),
}));

export const addressesRelations = relations(studentAddresses, ({ one }) => ({
  student: one(students, {
    fields: [studentAddresses.studentId],
    references: [students.id],
  }),
}));

export const guardiansRelations = relations(guardians, ({ one }) => ({
  student: one(students, {
    fields: [guardians.studentId],
    references: [students.id],
  }),
}));

// One-to-one reverse sides carry fields/references so Drizzle can infer the
// matching `one()` declared on `students` above.
export const previousSchoolsRelations = relations(previousSchools, ({ one }) => ({
  student: one(students, {
    fields: [previousSchools.studentId],
    references: [students.id],
  }),
}));

export const studentHealthRelations = relations(studentHealth, ({ one }) => ({
  student: one(students, {
    fields: [studentHealth.studentId],
    references: [students.id],
  }),
}));

// Types
export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type Teacher = typeof teachers.$inferSelect;
export type NewTeacher = typeof teachers.$inferInsert;
export type Enrollment = typeof enrollments.$inferSelect;
export type AcademicYear = typeof academicYears.$inferSelect;
export type Guardian = typeof guardians.$inferSelect;
export type StudentAddress = typeof studentAddresses.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Completion = typeof completions.$inferSelect;
export type NewCompletion = typeof completions.$inferInsert;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export type KeyStage = (typeof KEY_STAGES)[number];

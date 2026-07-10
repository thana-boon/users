import type { NextRequest } from 'next/server';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { students, enrollments } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, created, handleError, badRequest } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { resolveActiveYearId, upsertStudentFull } from '@/lib/services/students';
import type { ParsedStudent } from '@/lib/excel-map';

export const runtime = 'nodejs';

/**
 * GET  /api/users/students   - paged, filterable list joined to the enrollment
 *                              of the selected (or active) academic year.
 * POST /api/users/students   - create one student + this-year enrollment.
 *
 * Sensitive columns are never included here; reveal endpoints handle that.
 */

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').trim();
    const grade = (sp.get('grade') ?? '').trim();
    const classroom = (sp.get('classroom') ?? '').trim();
    const status = (sp.get('status') ?? '').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '25') || 25));
    const yearId = sp.get('yearId')
      ? Number(sp.get('yearId'))
      : await resolveActiveYearId();

    const conds = [eq(enrollments.academicYearId, yearId), eq(students.isArchived, false)];
    if (grade) conds.push(eq(enrollments.gradeLevel, grade));
    if (classroom) conds.push(eq(enrollments.classroom, classroom));
    if (status === 'studying' || status === 'withdrawn' || status === 'graduated') {
      conds.push(eq(students.status, status));
    }
    if (q) {
      conds.push(
        or(
          ilike(students.firstName, `%${q}%`),
          ilike(students.lastName, `%${q}%`),
          ilike(students.studentCode, `%${q}%`),
          ilike(students.nickname, `%${q}%`),
        )!,
      );
    }
    const where = and(...conds);

    const [rows, countRes] = await Promise.all([
      db
        .select({
          id: students.id,
          studentCode: students.studentCode,
          prefix: students.prefix,
          firstName: students.firstName,
          lastName: students.lastName,
          nickname: students.nickname,
          gender: students.gender,
          status: students.status,
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          classNumber: enrollments.classNumber,
          enrollmentId: enrollments.id,
        })
        .from(students)
        .innerJoin(enrollments, eq(enrollments.studentId, students.id))
        .where(where)
        .orderBy(enrollments.gradeLevel, enrollments.classroom, enrollments.seqOrder)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ n: sql<number>`count(*)` })
        .from(students)
        .innerJoin(enrollments, eq(enrollments.studentId, students.id))
        .where(where),
    ]);

    return ok({
      data: rows,
      page,
      pageSize,
      total: Number(countRes[0]?.n ?? 0),
      yearId,
    });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  studentCode: z.string().min(1),
  prefix: z.string().optional().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nickname: z.string().optional().nullable(),
  firstNameEn: z.string().optional().nullable(),
  lastNameEn: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  birthDate: z.string().optional().nullable(),
  religion: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  ethnicity: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  citizenId: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  admissionDate: z.string().optional().nullable(),
  gradeLevel: z.string().optional().nullable(),
  classroom: z.string().optional().nullable(),
  classNumber: z.string().optional().nullable(),
  yearId: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = createSchema.parse(await req.json());

    const dup = await db.query.students.findFirst({
      where: eq(students.studentCode, body.studentCode),
      columns: { id: true },
    });
    if (dup) return badRequest('รหัสนักเรียนนี้มีในระบบแล้ว');

    const yearId = body.yearId ?? (await resolveActiveYearId());
    const parsed: ParsedStudent = {
      core: {
        studentCode: body.studentCode,
        email: body.email ?? null,
        plainPassword: body.password ?? null,
        citizenId: body.citizenId ?? null,
        admissionDate: body.admissionDate ?? null,
        gender: body.gender ?? null,
        prefix: body.prefix ?? null,
        firstName: body.firstName,
        lastName: body.lastName,
        nickname: body.nickname ?? null,
        firstNameEn: body.firstNameEn ?? null,
        lastNameEn: body.lastNameEn ?? null,
        nicknameEn: null,
        birthDate: body.birthDate ?? null,
        religion: body.religion ?? null,
        nationality: body.nationality ?? null,
        ethnicity: body.ethnicity ?? null,
        siblingsTotal: null,
        siblingOrder: null,
        hasSiblingInSchool: null,
        phone: body.phone ?? null,
      },
      enrollment: {
        gradeLevel: body.gradeLevel ?? null,
        classroom: body.classroom ?? null,
        classNumber: body.classNumber ?? null,
        seqOrder: null,
      },
      addresses: [],
      previousSchool: null,
      guardians: [],
      health: null,
    };

    const { studentId } = await upsertStudentFull(parsed, yearId);
    await recordAudit({
      session: guard.session,
      action: 'create',
      targetType: 'student',
      targetId: studentId,
      targetLabel: `${body.studentCode} ${body.firstName} ${body.lastName}`,
      req,
    });
    return created({ id: studentId });
  } catch (err) {
    return handleError(err);
  }
}

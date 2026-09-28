import type { NextRequest } from 'next/server';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  ADDRESS_TYPES,
  GUARDIAN_TYPES,
  academicYears,
  enrollments,
  guardians,
  previousSchools,
  studentAddresses,
  studentHealth,
  students,
} from '@/db/schema';
import { requireApiScope, actorHasScope, apiError, insufficientScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { tryDecrypt } from '@/lib/crypto';
import {
  ADDRESS_FIELDS,
  GUARDIAN_FIELDS,
  HEALTH_FIELDS,
  IDENTITY_FIELDS,
  PREV_SCHOOL_FIELDS,
  resolveActiveYearId,
  updateStudentAggregate,
} from '@/lib/services/students';
import { readContactsFor, readEducationFor, readHealthFor } from '@/lib/services/student-extras';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/students/[id] — one student, resolved WITHOUT a year.
 *
 * This is the escape hatch from the list route's inner join. GET /students
 * joins the enrollments of one academic year, so a student who has no
 * enrollment in that year — left mid-year and was never promoted into the next
 * one — is unreachable there even with `?status=all`. A consumer holding an
 * `id` but not knowing which year the person left had no way to turn it back
 * into a name. Here the lookup is on `students.id` alone; enrollments are
 * joined in as *history*, never as a filter, so any non-archived student
 * resolves regardless of year or status.
 *
 * Since the point is the year-independent lookup, the response carries the
 * whole enrollment history too — rebuilding a student's path through the school
 * no longer means calling GET /students once per year.
 *
 * Auth: `students:read`. เลขบัตร ปชช. still requires the additive
 * `students:pii` and is audited, exactly as on the list route.
 *
 * Archived (ถังขยะ) students stay 404 here. Every other endpoint promises they
 * are gone; a by-id lookup that answered anyway would be a way around the bin
 * rather than a feature.
 *
 * `exitReason` is deliberately NOT exposed. The free-text reason a child left
 * can record family circumstances that no roster integration needs — callers
 * get the type/date/year, which is what reconciliation and document flows use.
 *
 * The photo blob is not inlined, matching the list route: `hasPhoto` /
 * `photoUrl` point at ./photo, which is gated by `students:photo`.
 *
 * `?include=health,contact,education` attaches the same opt-in blocks the list
 * route offers, behind the same additive scopes (`students:health` /
 * `students:contact` / `students:education`) and audited the same way. This is
 * the endpoint an emergency screen actually calls — one child, everything needed
 * to act — so it takes the blocks by id without needing to know which year they
 * are enrolled in. `education` (สถานศึกษาเดิม) is the block a ทะเบียน/รับย้าย
 * flow wants here for the same reason the route exists at all: it holds an id
 * and needs the child's history, not this year's roster row. Like `exitReason`,
 * เหตุที่ย้าย stays out of it at every scope.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiScope(req, 'students:read');
  if (!guard.ok) return guard.response;

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return apiError(400, 'invalid_id', 'id ต้องเป็นตัวเลข');
    }

    const withPii = actorHasScope(guard.actor, 'students:pii');

    const include = new Set(
      (req.nextUrl.searchParams.get('include') ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    );
    const wantHealth = include.has('health');
    const wantContact = include.has('contact');
    const wantEducation = include.has('education');
    if (wantHealth && !actorHasScope(guard.actor, 'students:health')) {
      return insufficientScope('students:health');
    }
    if (wantContact && !actorHasScope(guard.actor, 'students:contact')) {
      return insufficientScope('students:contact');
    }
    if (wantEducation && !actorHasScope(guard.actor, 'students:education')) {
      return insufficientScope('students:education');
    }

    const [rows, enrolled, activeYearId, years] = await Promise.all([
      db
        .select({
          id: students.id,
          studentCode: students.studentCode,
          prefix: students.prefix,
          firstName: students.firstName,
          lastName: students.lastName,
          nickname: students.nickname,
          firstNameEn: students.firstNameEn,
          lastNameEn: students.lastNameEn,
          gender: students.gender,
          birthDate: students.birthDate,
          email: students.email,
          phone: students.phone,
          additionalPhone: students.additionalPhone,
          status: students.status,
          exitType: students.exitType,
          exitDate: students.exitDate,
          exitAcademicYearId: students.exitAcademicYearId,
          isArchived: students.isArchived,
          citizenIdEncrypted: students.citizenIdEncrypted,
          // Same reason as the list route: never drag the base64 image out of
          // Postgres just to report whether one exists.
          hasPhoto: sql<boolean>`${students.photoBase64} is not null`,
        })
        .from(students)
        .where(eq(students.id, id))
        .limit(1),
      db
        .select({
          yearId: enrollments.academicYearId,
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          classNumber: enrollments.classNumber,
        })
        .from(enrollments)
        .where(eq(enrollments.studentId, id)),
      resolveActiveYearId(),
      // The whole table is a handful of rows, and both the active year and the
      // exit year need naming — one fetch beats a conditional lookup each.
      db
        .select({
          id: academicYears.id,
          year: academicYears.year,
          startDate: academicYears.startDate,
          endDate: academicYears.endDate,
          term1Start: academicYears.term1Start,
          term1End: academicYears.term1End,
          term2Start: academicYears.term2Start,
          term2End: academicYears.term2End,
        })
        .from(academicYears)
        .orderBy(asc(academicYears.year)),
    ]);

    const row = rows[0];
    if (!row || row.isArchived) return apiError(404, 'not_found', 'ไม่พบนักเรียนรายนี้');

    const yearById = new Map(years.map((y) => [y.id, y]));
    // Newest first: the most recent placement is what a caller resolving a
    // stale id almost always wants, and it makes [0] a useful default.
    const history = enrolled
      .map((e) => ({ ...e, year: yearById.get(e.yearId)?.year ?? null }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

    const current = history.find((e) => e.yearId === activeYearId) ?? null;
    const exitYear = row.exitAcademicYearId ? yearById.get(row.exitAcademicYearId) : undefined;

    const { citizenIdEncrypted, isArchived, exitType, exitDate, exitAcademicYearId, ...core } = row;

    // Fetched only after the 404 above, so a probe for a nonexistent id never
    // costs two extra queries.
    const [healthById, contactById, educationById] = await Promise.all([
      wantHealth ? readHealthFor([row.id]) : null,
      wantContact ? readContactsFor([row.id]) : null,
      wantEducation ? readEducationFor([row.id]) : null,
    ]);

    if (withPii || wantHealth || wantContact || wantEducation) {
      const blocks = [
        withPii ? 'เลขบัตรประชาชน' : null,
        wantHealth ? 'ข้อมูลสุขภาพ' : null,
        wantContact ? 'ผู้ติดต่อฉุกเฉิน' : null,
        wantEducation ? 'สถานศึกษาเดิม' : null,
      ].filter(Boolean);
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        // Same rule as the list route: only call it a citizen-id reveal when
        // one was actually returned.
        action: withPii ? 'reveal_citizen_id' : 'api_read',
        targetType: 'student',
        targetId: row.id,
        targetLabel: `public API · ${row.studentCode} ${row.firstName} ${row.lastName} · ${blocks.join(' + ')}`,
        detail: `GET /api/public/v1/students/${row.id}`,
        req,
      });
    }

    return ok({
      data: {
        ...core,
        fullName: `${row.prefix ?? ''}${row.firstName} ${row.lastName}`.trim(),
        // Flattened current placement, so a row from here is shaped like a row
        // from GET /students and a caller can reuse the same mapper. null when
        // the student has no enrollment in the active year — which is exactly
        // the case that makes this endpoint necessary.
        gradeLevel: current?.gradeLevel ?? null,
        classroom: current?.classroom ?? null,
        classNumber: current?.classNumber ?? null,
        photoUrl: row.hasPhoto ? `/api/public/v1/students/${row.id}/photo` : null,
        ...(withPii ? { citizenId: tryDecrypt(citizenIdEncrypted) } : {}),
        ...(healthById ? { health: healthById.get(row.id) ?? null } : {}),
        ...(contactById ? { contact: contactById.get(row.id) ?? null } : {}),
        ...(educationById ? { education: educationById.get(row.id) ?? null } : {}),
        exit:
          exitType || exitDate || exitAcademicYearId
            ? {
                type: exitType,
                date: exitDate,
                yearId: exitAcademicYearId,
                year: exitYear?.year ?? null,
              }
            : null,
        enrollments: history,
        // Which year `gradeLevel`/`classroom`/`classNumber` above refer to.
        // Same shape as the list route's `academicYear`.
        academicYear: yearById.get(activeYearId) ?? null,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

// -- PATCH: write a student's record back ------------------------------

/**
 * PATCH /api/public/v1/students/{id} — the write-back the school asked for
 * (2026-09), so a sibling system can correct a record instead of someone
 * re-typing it here.
 *
 * Scope `students:write` covers ประวัติ (identity), `addresses`, `guardians`
 * and `previousSchool`. `health` additionally needs `students:health:write` —
 * it is a child's medical information and has its own scope on the read side
 * too.
 *
 * NOT writable at any scope, because each is the account or the lifecycle and
 * belongs to the admin UI: studentCode, password, email (a login identifier),
 * citizenId and every other encrypted value (guardian citizenId, income),
 * status / exit / leaves, grade / room / เลขที่ (promotions page), archive, and
 * the photo. `.strict()` everywhere makes naming one a 400, never a quiet no-op.
 *
 * PARTIAL, all the way down: a top-level key that is absent is left alone,
 * `null`/"" clears it, and inside an address/guardian/health/previousSchool
 * object only the keys sent are changed — the rest is merged from what is
 * stored. (The shared service writes a block whole, so the merge happens
 * here; without it, sending one guardian's mobile number would blank that
 * guardian's name.) Addresses and guardians are addressed by their type key
 * (`addressType` household/birth_place/current/hometown, `guardianType`
 * guardian/father/mother), one object per type per request.
 */
const nstr = z.string().nullable().optional();
function fieldsOf<K extends string>(keys: readonly K[]) {
  return Object.fromEntries(keys.map((k) => [k, nstr])) as Record<K, typeof nstr>;
}

// Identity minus email: email is a student login identifier (student-login
// accepts it in place of the code), so it is account, not profile.
const WRITABLE_IDENTITY = IDENTITY_FIELDS.filter((k) => k !== 'email');

const addressSchema = z
  .object({ addressType: z.enum(ADDRESS_TYPES), ...fieldsOf(ADDRESS_FIELDS) })
  .strict();
const guardianSchema = z
  .object({ guardianType: z.enum(GUARDIAN_TYPES), ...fieldsOf(GUARDIAN_FIELDS) })
  .strict();

function distinct(keys: string[]): boolean {
  return new Set(keys).size === keys.length;
}

const studentPatchSchema = z
  .object({
    ...fieldsOf(WRITABLE_IDENTITY),
    // notNull columns: may be changed, never blanked.
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    addresses: z
      .array(addressSchema)
      .max(ADDRESS_TYPES.length)
      .refine((l) => distinct(l.map((a) => a.addressType)), 'addressType ซ้ำกันใน request เดียว')
      .optional(),
    guardians: z
      .array(guardianSchema)
      .max(GUARDIAN_TYPES.length)
      .refine((l) => distinct(l.map((g) => g.guardianType)), 'guardianType ซ้ำกันใน request เดียว')
      .optional(),
    previousSchool: z.object(fieldsOf(PREV_SCHOOL_FIELDS)).strict().optional(),
    health: z.object(fieldsOf(HEALTH_FIELDS)).strict().optional(),
  })
  .strict();

type Block = Record<string, string | null | undefined>;

/** Stored block + the keys the caller sent (undefined = keep). */
function merge(fields: readonly string[], stored: object | undefined, sent: object): Block {
  const base = (stored ?? {}) as Record<string, unknown>;
  const given = sent as Record<string, string | null | undefined>;
  const out: Block = {};
  for (const k of fields) {
    out[k] = given[k] !== undefined ? given[k] : ((base[k] as string | null | undefined) ?? null);
  }
  return out;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiScope(req, 'students:write');
  if (!guard.ok) return guard.response;

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return apiError(400, 'invalid_id', 'id ต้องเป็นตัวเลข');
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError(400, 'invalid_body', 'body ต้องเป็น JSON');
    }
    const parsed = studentPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(
        400,
        'invalid_body',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(', '),
      );
    }
    const body = parsed.data;

    // Health is its own scope, checked before anything is written so a key
    // without it cannot land half a request.
    if (body.health && !actorHasScope(guard.actor, 'students:health:write')) {
      return insufficientScope('students:health:write');
    }

    const s = await db.query.students.findFirst({
      where: eq(students.id, id),
      columns: { id: true, studentCode: true, firstName: true, lastName: true, isArchived: true },
    });
    if (!s || s.isArchived) return apiError(404, 'not_found', 'ไม่พบนักเรียนรายนี้');

    const [storedAddr, storedGuard, storedHealth, storedPrev] = await Promise.all([
      body.addresses
        ? db.select().from(studentAddresses).where(eq(studentAddresses.studentId, id))
        : Promise.resolve([]),
      body.guardians
        ? db.select().from(guardians).where(eq(guardians.studentId, id))
        : Promise.resolve([]),
      body.health
        ? db.query.studentHealth.findFirst({ where: eq(studentHealth.studentId, id) })
        : Promise.resolve(undefined),
      body.previousSchool
        ? db.query.previousSchools.findFirst({ where: eq(previousSchools.studentId, id) })
        : Promise.resolve(undefined),
    ]);

    const identity: Block = {};
    for (const k of WRITABLE_IDENTITY) {
      const v = (body as Record<string, unknown>)[k] as string | null | undefined;
      if (v !== undefined) identity[k] = v;
    }

    const updated = [
      ...Object.keys(identity),
      ...(body.addresses ?? []).map((a) => `addresses.${a.addressType}`),
      ...(body.guardians ?? []).map((g) => `guardians.${g.guardianType}`),
      ...(body.previousSchool ? ['previousSchool'] : []),
      ...(body.health ? ['health'] : []),
    ];
    if (updated.length === 0) return apiError(400, 'invalid_body', 'ไม่มีฟิลด์ให้แก้ไข');

    await updateStudentAggregate(id, {
      ...identity,
      addresses: body.addresses?.map((a) => ({
        ...merge(ADDRESS_FIELDS, storedAddr.find((x) => x.addressType === a.addressType), a),
        addressType: a.addressType,
      })),
      guardians: body.guardians?.map((g) => ({
        ...merge(GUARDIAN_FIELDS, storedGuard.find((x) => x.guardianType === g.guardianType), g),
        guardianType: g.guardianType,
      })),
      previousSchool: body.previousSchool
        ? merge(PREV_SCHOOL_FIELDS, storedPrev, body.previousSchool)
        : undefined,
      health: body.health ? merge(HEALTH_FIELDS, storedHealth, body.health) : undefined,
    });

    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'update',
      targetType: 'student',
      targetId: id,
      targetLabel: `${s.studentCode} ${s.firstName} ${s.lastName}`,
      detail: `public API แก้ไข: ${updated.join(', ')}`,
      req,
    });

    return ok({ data: { id, studentCode: s.studentCode }, updated });
  } catch (err) {
    return handleError(err);
  }
}

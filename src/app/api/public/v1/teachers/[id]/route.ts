import type { NextRequest } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { academicYears, homeroomTeachers, teachers } from '@/db/schema';
import { requireApiScope, actorHasScope, apiError, insufficientScope } from '@/lib/apiauth';
import { ok, notFound, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { resolveActiveYearId } from '@/lib/services/students';
import {
  PUBLIC_TEACHER_COLUMNS,
  describeLists,
  noQualifications,
  profileColumns,
  readQualificationsFor,
  replaceTeacherLists,
  shapePublicTeacher,
  teacherListsSchema,
  teacherProfileFieldsSchema,
} from '@/lib/services/teachers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET   /api/public/v1/teachers/{id} — one teacher, in full.
 * PATCH /api/public/v1/teachers/{id} — write a teacher's record back.
 *
 * GET is the twin of ./students/{id}: the same row the list returns, plus the
 * three qualification lists (วุฒิการศึกษา / วุฒิทางลูกเสือ / การผ่านอบรม) always
 * included. On the list they are opt-in because they multiply the payload
 * across a page; for one teacher there is nothing to weigh.
 *
 * Auth: `teachers:read`; เลขบัตร ปชช. still needs the additive `teachers:pii`
 * and is still audited; `?include=contact` (ผู้ติดต่อฉุกเฉิน + ที่อยู่ตาม
 * ทะเบียนบ้าน) needs `teachers:contact`. `{id}` is the numeric id the list
 * returns — a teacherCode lookup belongs on the list (`?q=`).
 *
 * Archived teachers are 404: they are in the trash, and a feed that kept
 * serving them would quietly resurrect people the school deleted.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiScope(req, 'teachers:read');
  if (!guard.ok) return guard.response;

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return notFound();

    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    const withPii = actorHasScope(guard.actor, 'teachers:pii');
    const include = new Set(
      (sp.get('include') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    );
    const withContact = include.has('contact');
    if (withContact && !actorHasScope(guard.actor, 'teachers:contact')) {
      return insufficientScope('teachers:contact');
    }

    const [row] = await db
      .select({
        ...PUBLIC_TEACHER_COLUMNS,
        hasPhoto: sql<boolean>`${teachers.photoBase64} is not null`,
      })
      .from(teachers)
      .where(and(eq(teachers.id, id), eq(teachers.isArchived, false)))
      .limit(1);

    if (!row) return notFound();

    const [assignRows, yearRow, quals] = await Promise.all([
      db
        .select({
          gradeLevel: homeroomTeachers.gradeLevel,
          classroom: homeroomTeachers.classroom,
        })
        .from(homeroomTeachers)
        .where(
          and(
            eq(homeroomTeachers.academicYearId, yearId),
            eq(homeroomTeachers.teacherId, id),
          ),
        ),
      db.query.academicYears.findFirst({ where: eq(academicYears.id, yearId) }),
      readQualificationsFor([id]),
    ]);

    if (withPii || withContact) {
      const blocks = [
        withPii ? 'เลขบัตรประชาชน' : null,
        withContact ? 'ผู้ติดต่อฉุกเฉิน/ที่อยู่' : null,
      ].filter(Boolean);
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: withPii ? 'reveal_citizen_id' : 'api_read',
        targetType: 'teacher',
        targetId: id,
        targetLabel: `${row.teacherCode} ${row.firstName} ${row.lastName}`,
        detail: `GET /api/public/v1/teachers/${id} · ${blocks.join(' + ')}`,
        req,
      });
    }

    return ok({
      ...shapePublicTeacher(row, { withPii, withContact }),
      homerooms: assignRows,
      ...(quals.get(id) ?? noQualifications()),
      academicYear: yearRow ? { id: yearRow.id, year: yearRow.year } : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * The writable surface — every field the admin teacher page edits, MINUS the
 * account and the lifecycle (see `teachers:write` in lib/api-scopes.ts):
 * teacherCode, role, password, email (a login identifier), citizenId,
 * employmentStatus/exit*, isArchived and the photo are not here, and
 * `.strict()` turns a payload naming any of them into a 400 rather than a quiet
 * no-op — an integration that believes it changed a role must be told it did not.
 *
 * A PATCH is partial: a key that is absent is left alone; `null` or "" clears
 * it. The three qualification lists are the exception, as everywhere in this
 * module: a list that IS sent replaces the teacher's whole list (send `[]` to
 * empty it). `householdAddress` is partial by key inside the object.
 */
const patchSchema = teacherProfileFieldsSchema
  .merge(teacherListsSchema)
  .extend({
    prefix: z.string().nullable().optional(),
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    subjectGroup: z.string().nullable().optional(),
    gradeTaught: z.string().nullable().optional(),
  })
  .strict();

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiScope(req, 'teachers:write');
  if (!guard.ok) return guard.response;

  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return apiError(404, 'not_found', 'ไม่พบครูรายนี้');

    const t = await db.query.teachers.findFirst({
      where: eq(teachers.id, id),
      columns: { id: true, teacherCode: true, firstName: true, lastName: true, isArchived: true },
    });
    if (!t || t.isArchived) return apiError(404, 'not_found', 'ไม่พบครูรายนี้');

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError(400, 'invalid_body', 'body ต้องเป็น JSON');
    }
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(
        400,
        'invalid_body',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(', '),
      );
    }

    const { educations, scoutQualifications, trainings, ...rest } = parsed.data;
    const set = profileColumns(rest);
    const lists = { educations, scoutQualifications, trainings };
    if (!Object.keys(set).length && !educations && !scoutQualifications && !trainings) {
      return apiError(400, 'invalid_body', 'ไม่มีฟิลด์ให้แก้ไข');
    }

    if (Object.keys(set).length) {
      await db.update(teachers).set(set).where(eq(teachers.id, id));
    }
    await replaceTeacherLists(id, lists);

    const fields = [
      ...new Set(Object.keys(rest).filter((k) => rest[k as keyof typeof rest] !== undefined)),
    ];
    await recordAudit({
      session: guard.actor.kind === 'session' ? guard.actor.session : null,
      actorLabel: guard.actor.label,
      actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
      action: 'update',
      targetType: 'teacher',
      targetId: id,
      targetLabel: `${t.teacherCode} ${t.firstName} ${t.lastName}`,
      detail: `public API แก้ไข: ${[...fields, ...describeLists(lists)].join(', ')}`,
      req,
    });

    return ok({
      data: { id, teacherCode: t.teacherCode },
      updated: [...fields, ...Object.entries(lists).filter(([, v]) => v).map(([k]) => k)],
    });
  } catch (err) {
    return handleError(err);
  }
}

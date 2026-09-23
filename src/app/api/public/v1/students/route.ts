import type { NextRequest } from 'next/server';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { students, enrollments, academicYears } from '@/db/schema';
import { requireApiScope, actorHasScope, insufficientScope } from '@/lib/apiauth';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { tryDecrypt } from '@/lib/crypto';
import { resolveActiveYearId } from '@/lib/services/students';
import { gradeRank, roomRank, roomText } from '@/lib/grade-sql';
import { readContactsFor, readHealthFor } from '@/lib/services/student-extras';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/students — roster feed for other SchoolOS systems.
 *
 * Auth: `students:read` (API key or admin session — see requireApiScope).
 * PII:  เลขบัตร ปชช. is included ONLY with the additive `students:pii` scope,
 *       and every such response is audited.
 *
 * Deliberately excluded regardless of scope: password_encrypted (no integration
 * has a reason to read login credentials) and photo_base64 (would bloat every
 * page — a photo is ~100x a roster row). Photos have their own routes:
 *   ./[id]/photo   one image, raw bytes, ETag-cached
 *   ./photos?ids=  up to 50 at a time, base64
 * both gated by the additive `students:photo` scope. `hasPhoto`/`photoUrl` here
 * let a caller fetch only the students that actually have one.
 *
 * Opt-in blocks, `?include=health,contact`, each behind its own additive scope
 * (`students:health` / `students:contact`) and each audited per response like
 * `:pii` is. Asking for a block the key does not carry is a 403 rather than a
 * silently thinner payload — an integration must never believe a child has no
 * recorded allergy when the truth is that it was not allowed to ask.
 *
 * Query: ?yearId= ?grade= ?classroom= ?status= ?q= ?page= ?pageSize= (max 200)
 *        ?include=health,contact
 */
export async function GET(req: NextRequest) {
  const guard = await requireApiScope(req, 'students:read');
  if (!guard.ok) return guard.response;

  try {
    const sp = req.nextUrl.searchParams;
    const yearId = sp.get('yearId') ? Number(sp.get('yearId')) : await resolveActiveYearId();
    const grade = (sp.get('grade') ?? '').trim();
    const classroom = (sp.get('classroom') ?? '').trim();
    const status = (sp.get('status') ?? 'studying').trim();
    const q = (sp.get('q') ?? '').trim();
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize') ?? '50') || 50));

    const withPii = actorHasScope(guard.actor, 'students:pii');

    // Comma-separated so further blocks can be added without a new parameter
    // each time — the same shape the teachers feed uses for `qualifications`.
    const include = new Set(
      (sp.get('include') ?? '').split(',').map((v) => v.trim()).filter(Boolean),
    );
    const wantHealth = include.has('health');
    const wantContact = include.has('contact');
    if (wantHealth && !actorHasScope(guard.actor, 'students:health')) {
      return insufficientScope('students:health');
    }
    if (wantContact && !actorHasScope(guard.actor, 'students:contact')) {
      return insufficientScope('students:contact');
    }

    const conds = [eq(students.isArchived, false), eq(enrollments.academicYearId, yearId)];
    if (grade) conds.push(eq(enrollments.gradeLevel, grade));
    if (classroom) conds.push(eq(enrollments.classroom, classroom));
    // `all` intentionally spans studying/withdrawn/graduated for systems that
    // reconcile historic rosters; the default stays the current roll.
    if (status && status !== 'all') {
      if (status === 'studying' || status === 'withdrawn' || status === 'graduated') {
        conds.push(eq(students.status, status));
      }
    }
    if (q) {
      conds.push(
        or(
          ilike(students.firstName, `%${q}%`),
          ilike(students.lastName, `%${q}%`),
          ilike(students.studentCode, `%${q}%`),
        )!,
      );
    }
    const where = and(...conds);

    const [rows, countRes, yearRow] = await Promise.all([
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
          gradeLevel: enrollments.gradeLevel,
          classroom: enrollments.classroom,
          classNumber: enrollments.classNumber,
          citizenIdEncrypted: students.citizenIdEncrypted,
          // `is not null` rather than the column itself: asking Postgres for the
          // base64 text of a page of students is exactly the bloat this avoids.
          hasPhoto: sql<boolean>`${students.photoBase64} is not null`,
        })
        .from(students)
        .innerJoin(enrollments, eq(enrollments.studentId, students.id))
        .where(where)
        // ชั้น by curriculum order (เตรียมอนุบาล → อ → ป → ม) — consumers page
        // through this feed and expect the same order the module shows.
        .orderBy(
          asc(gradeRank(enrollments.gradeLevel)),
          asc(roomRank(enrollments.classroom)),
          asc(roomText(enrollments.classroom)),
          asc(enrollments.seqOrder),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ n: sql<number>`count(*)` })
        .from(students)
        .innerJoin(enrollments, eq(enrollments.studentId, students.id))
        .where(where),
      db.query.academicYears.findFirst({ where: eq(academicYears.id, yearId) }),
    ]);

    // One query per requested block for the whole page, keyed by student id.
    const ids = rows.map((r) => r.id);
    const [healthById, contactById] = await Promise.all([
      wantHealth ? readHealthFor(ids) : null,
      wantContact ? readContactsFor(ids) : null,
    ]);

    const data = rows.map((r) => {
      const { citizenIdEncrypted, ...rest } = r;
      return {
        ...rest,
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        // Relative on purpose — the caller already knows the host it dialled,
        // and this module can be mounted under a gateway prefix.
        photoUrl: r.hasPhoto ? `/api/public/v1/students/${r.id}/photo` : null,
        ...(withPii ? { citizenId: tryDecrypt(citizenIdEncrypted) } : {}),
        ...(healthById ? { health: healthById.get(r.id) ?? null } : {}),
        ...(contactById ? { contact: contactById.get(r.id) ?? null } : {}),
      };
    });

    if (data.length > 0 && (withPii || wantHealth || wantContact)) {
      // One row per response, naming every sensitive block it carried. The
      // action stays `reveal_citizen_id` only when an id actually went out;
      // otherwise this is an `api_read` of the health/contact blocks, and the
      // log must not imply a citizen id was handed over when none was.
      const blocks = [
        withPii ? 'เลขบัตรประชาชน' : null,
        wantHealth ? 'ข้อมูลสุขภาพ' : null,
        wantContact ? 'ผู้ติดต่อฉุกเฉิน' : null,
      ].filter(Boolean);
      await recordAudit({
        session: guard.actor.kind === 'session' ? guard.actor.session : null,
        actorLabel: guard.actor.label,
        actorRole: guard.actor.kind === 'key' ? 'api_key' : undefined,
        action: withPii ? 'reveal_citizen_id' : 'api_read',
        targetType: 'student',
        targetLabel: `public API · ${data.length} รายการ · ${blocks.join(' + ')}`,
        detail: `GET /api/public/v1/students?${sp.toString()}`,
        req,
      });
    }

    return ok({
      data,
      page,
      pageSize,
      total: Number(countRes[0]?.n ?? 0),
      academicYear: yearRow
        ? {
            id: yearRow.id,
            year: yearRow.year,
            // Term windows are additive fields — existing consumers that only
            // read {id, year} are unaffected.
            startDate: yearRow.startDate,
            endDate: yearRow.endDate,
            term1Start: yearRow.term1Start,
            term1End: yearRow.term1End,
            term2Start: yearRow.term2Start,
            term2End: yearRow.term2End,
          }
        : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

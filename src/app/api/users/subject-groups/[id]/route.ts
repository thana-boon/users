import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { specialTeachers, subjectGroups, teachers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { cleanGroupName, countGroupUsage } from '@/lib/services/subject-groups';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH/DELETE one กลุ่มสาระ.
 *
 * The rename is the reason this route is interesting. Because the rosters store
 * the NAME (see src/lib/services/subject-groups.ts), renaming a group has to
 * rewrite `teachers.subject_group` and `special_teachers.subject_group` in the
 * same transaction — otherwise the moment the name changed, every teacher
 * filed under the old spelling would fall out of the picker and out of every
 * `?subjectGroup=` query the other SchoolOS systems run.
 *
 * That is also why renaming ONTO an existing group is refused: it would merge
 * two groups' people together, which is a decision an admin should make one
 * person at a time, not as a side effect of fixing a typo.
 */
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const body = patchSchema.parse(await req.json());

    const row = await db.query.subjectGroups.findFirst({ where: eq(subjectGroups.id, id) });
    if (!row) return notFound('ไม่พบกลุ่มสาระนี้');

    const details: string[] = [];
    let moved = 0;

    if (body.name !== undefined) {
      const name = cleanGroupName(body.name);
      if (!name) return badRequest('กรุณากรอกชื่อกลุ่มสาระ');
      if (name.length > 191) return badRequest('ชื่อกลุ่มสาระยาวเกิน 191 ตัวอักษร');

      if (name !== row.name) {
        const dup = await db.query.subjectGroups.findFirst({
          where: eq(subjectGroups.name, name),
          columns: { id: true },
        });
        if (dup) return badRequest('มีกลุ่มสาระชื่อนี้อยู่แล้ว — ถ้าต้องการรวมกลุ่ม ให้ย้ายคนทีละคนแทน');

        const before = await countGroupUsage(row.name);
        await db.transaction(async (tx) => {
          await tx.update(subjectGroups).set({ name }).where(eq(subjectGroups.id, id));
          await tx
            .update(teachers)
            .set({ subjectGroup: name })
            .where(eq(teachers.subjectGroup, row.name));
          await tx
            .update(specialTeachers)
            .set({ subjectGroup: name })
            .where(eq(specialTeachers.subjectGroup, row.name));
        });
        moved = before.teachers + before.specialTeachers;
        details.push(`เปลี่ยนชื่อ “${row.name}” → “${name}” (ย้ายตาม ${moved} คน)`);
      }
    }

    if (body.isActive !== undefined && body.isActive !== row.isActive) {
      await db.update(subjectGroups).set({ isActive: body.isActive }).where(eq(subjectGroups.id, id));
      details.push(body.isActive ? 'เปิดใช้งาน' : 'ซ่อนจากตัวเลือก');
    }

    if (details.length === 0) return ok({ ok: true, moved: 0 });

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'subject_group',
      targetId: id,
      targetLabel: body.name ? cleanGroupName(body.name) : row.name,
      detail: details.join(' · '),
      req,
    });
    return ok({ ok: true, moved });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * DELETE — only when nobody is filed under it. A group with people in it is
 * deleted by hiding it (PATCH isActive:false), which keeps their existing
 * subject_group text intact; a hard delete would leave those rows pointing at a
 * name no longer in any list, which is exactly the mess this table replaced.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const id = Number((await params).id);
    const row = await db.query.subjectGroups.findFirst({ where: eq(subjectGroups.id, id) });
    if (!row) return notFound('ไม่พบกลุ่มสาระนี้');

    const used = await countGroupUsage(row.name);
    const total = used.teachers + used.specialTeachers;
    if (total > 0) {
      return badRequest(
        `ลบไม่ได้ — ยังมี ${used.teachers} ครู และ ${used.specialTeachers} อาจารย์พิเศษ อยู่ในกลุ่มสาระนี้ ` +
          'ให้ย้ายคนเหล่านี้ไปกลุ่มอื่นก่อน หรือกด “ซ่อน” เพื่อไม่ให้เลือกกลุ่มนี้ได้อีก',
      );
    }

    await db.delete(subjectGroups).where(eq(subjectGroups.id, id));
    await recordAudit({
      session: guard.session,
      action: 'delete',
      targetType: 'subject_group',
      targetId: id,
      targetLabel: row.name,
      req,
    });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

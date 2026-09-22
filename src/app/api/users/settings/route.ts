import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { readSelfEditSettings, setSelfEdit } from '@/lib/services/settings';

export const runtime = 'nodejs';

/**
 * GET   /api/users/settings — the school-wide switches.
 * PATCH /api/users/settings — flip one or both.
 *
 * Three switches today: the ครู and นักเรียน self-edit windows, plus the
 * additive one that decides whether either audience may see and correct their
 * own เลขบัตรประชาชน. The third grants nothing on its own — the audience window
 * must be open too — so flipping it on while both others are closed is a no-op
 * the page says so about.
 *
 * Admin-only, like the rest of /api/users. The switches themselves are read by
 * the self-service routes through services/settings.ts, which caches them for a
 * few seconds; flipping one clears that cache, so the admin who flipped it sees
 * the effect on their next request rather than on the next TTL.
 */

const patchSchema = z
  .object({
    selfEditTeachers: z.boolean().optional(),
    selfEditStudents: z.boolean().optional(),
    selfEditSensitive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'ต้องระบุอย่างน้อยหนึ่งค่า',
  });

/** One shape for GET and PATCH, so the page never has to reconcile two. */
function payload(s: Awaited<ReturnType<typeof readSelfEditSettings>>) {
  return {
    selfEditTeachers: s.teacher,
    selfEditStudents: s.student,
    selfEditSensitive: s.sensitive,
  };
}

export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    return ok(payload(await readSelfEditSettings()));
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const body = patchSchema.parse(await req.json());
    const actor = guard.session.name ?? guard.session.sub;
    const changed: string[] = [];

    if (body.selfEditTeachers !== undefined) {
      await setSelfEdit('teacher', body.selfEditTeachers, actor);
      changed.push(`ครูแก้ข้อมูลตนเอง: ${body.selfEditTeachers ? 'เปิด' : 'ปิด'}`);
    }
    if (body.selfEditStudents !== undefined) {
      await setSelfEdit('student', body.selfEditStudents, actor);
      changed.push(`นักเรียนแก้ข้อมูลตนเอง: ${body.selfEditStudents ? 'เปิด' : 'ปิด'}`);
    }
    if (body.selfEditSensitive !== undefined) {
      await setSelfEdit('sensitive', body.selfEditSensitive, actor);
      changed.push(
        `ดู/แก้ไขเลขบัตรประชาชนของตนเอง: ${body.selfEditSensitive ? 'เปิด' : 'ปิด'}`,
      );
    }

    await recordAudit({
      session: guard.session,
      action: 'update',
      targetType: 'settings',
      targetLabel: 'ตั้งค่าระบบ',
      detail: changed.join(', '),
      req,
    });

    return ok(payload(await readSelfEditSettings()));
  } catch (err) {
    return handleError(err);
  }
}

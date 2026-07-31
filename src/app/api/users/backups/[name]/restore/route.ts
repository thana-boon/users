import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, notFound } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import {
  backupDir,
  handleBackupError,
  isValidBackupName,
  restoreBackup,
} from '@/lib/backup';

export const runtime = 'nodejs';
/** A restore of a school-sized database, worst case, on a busy server. */
export const maxDuration = 1800;

/**
 * POST /api/users/backups/<file>/restore — replace the entire database with the
 * contents of this backup.
 *
 * The single most destructive operation in the module. Three things stand
 * between a mis-click and lost records: the UI makes you type the confirmation
 * phrase, `restoreBackup` takes a `prerestore` copy of the CURRENT data first,
 * and pg_restore runs in one transaction so a half-finished restore rolls back.
 *
 * The audit row is written after the fact, on purpose: the restore replaces the
 * audit_logs table too, so a row written first would be wiped by the very
 * operation it records. Written afterwards it lands in the restored trail and
 * survives — which is why the previous history now ends at the backup's own
 * timestamp, with this row explaining the jump.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const name = decodeURIComponent((await ctx.params).name);
    if (!isValidBackupName(name)) return notFound('ไม่พบไฟล์สำรองนี้');
    try {
      await fs.access(path.join(backupDir(), name));
    } catch {
      return notFound('ไม่พบไฟล์สำรองนี้');
    }

    const actor = guard.session.name ?? guard.session.sub;
    const result = await restoreBackup(name, { actor });

    await recordAudit({
      session: guard.session,
      action: 'restore_backup',
      targetType: 'backup',
      targetLabel: name,
      detail:
        `กู้คืนข้อมูลทั้งระบบจากไฟล์ ${name} ` +
        `(ใช้เวลา ${Math.round(result.durationMs / 1000)} วินาที · ` +
        `สำรองข้อมูลเดิมไว้ที่ ${result.safetyBackup})`,
      req,
    });

    return ok(result);
  } catch (err) {
    return handleBackupError(err);
  }
}

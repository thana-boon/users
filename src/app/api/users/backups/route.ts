import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import {
  RETENTION,
  createBackup,
  currentOperation,
  databaseLabel,
  dirStatus,
  handleBackupError,
  listBackups,
  readRunStatus,
  toolsAvailable,
} from '@/lib/backup';
import { scheduleInfo } from '@/lib/backup-schedule';

export const runtime = 'nodejs';
/** A dump of a school's whole database is minutes of work, not seconds. */
export const maxDuration = 900;

/**
 * GET  — the backups page in one call: the files, plus everything needed to
 *        explain the state of the system (is the folder writable, are the
 *        postgres tools installed, when does the next nightly run fire, how did
 *        the last one go).
 * POST  — take a backup now ("สำรองข้อมูลทันที").
 */
export async function GET(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const [files, dir, tools, status] = await Promise.all([
      listBackups(),
      dirStatus(),
      toolsAvailable(),
      readRunStatus(),
    ]);
    const busy = currentOperation();
    return ok({
      data: files,
      dir: dir.dir,
      writable: dir.writable,
      hint: dir.hint,
      toolsAvailable: tools,
      database: databaseLabel(),
      retention: {
        auto: RETENTION.auto,
        manual: RETENTION.manual,
        prerestore: RETENTION.prerestore,
      },
      schedule: scheduleInfo(),
      lastRun: status,
      busy: busy ? { what: busy.what, since: new Date(busy.since).toISOString() } : null,
    });
  } catch (err) {
    return handleBackupError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const actor = guard.session.name ?? guard.session.sub;
    const result = await createBackup({ kind: 'manual', actor });
    await recordAudit({
      session: guard.session,
      action: 'backup',
      targetType: 'backup',
      targetLabel: result.file.name,
      detail:
        `สำรองข้อมูลเอง (${Math.round(result.file.bytes / 1024 / 1024)} MB, ` +
        `${Math.round(result.durationMs / 1000)} วินาที)` +
        (result.pruned.length ? ` · ลบไฟล์เก่า ${result.pruned.length} ไฟล์` : ''),
      req,
    });
    return ok(result);
  } catch (err) {
    return handleBackupError(err);
  }
}

import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import { handleBackupError, saveUploadedBackup } from '@/lib/backup';

export const runtime = 'nodejs';
export const maxDuration = 900;

/** Ceiling for an uploaded dump. Override with BACKUP_MAX_UPLOAD_MB. */
function maxBytes(): number {
  const mb = Number(process.env.BACKUP_MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 2048) * 1024 * 1024;
}

/**
 * POST /api/users/backups/upload?name=<original filename>
 *
 * Body is the raw .dump file — NOT multipart. Multipart would mean parsing the
 * whole upload into memory via formData(), and these files are the size of the
 * database. Sending the File object straight as the body streams it to disk
 * instead, so a multi-gigabyte dump costs a constant amount of memory.
 *
 * This is the path back from a server that had to be rebuilt: the dumps that
 * were downloaded earlier go back up, and can then be restored like any other.
 * The file is verified with `pg_restore --list` before it is accepted, so an
 * unreadable file is rejected here rather than discovered during a restore.
 */
export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    if (!req.body) return badRequest('ไม่พบข้อมูลไฟล์ในคำขอ');

    const originalName = req.nextUrl.searchParams.get('name')?.slice(0, 200) || undefined;
    const actor = guard.session.name ?? guard.session.sub;

    const file = await saveUploadedBackup(req.body, {
      originalName,
      actor,
      maxBytes: maxBytes(),
    });

    await recordAudit({
      session: guard.session,
      action: 'upload_backup',
      targetType: 'backup',
      targetLabel: file.name,
      detail:
        `อัปโหลดไฟล์สำรอง ${originalName ?? file.name} ` +
        `(${Math.round(file.bytes / 1024 / 1024)} MB) — เก็บเป็น ${file.name}`,
      req,
    });

    return ok(file);
  } catch (err) {
    return handleBackupError(err);
  }
}

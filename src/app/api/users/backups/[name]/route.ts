import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, notFound } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import {
  backupDir,
  deleteBackup,
  handleBackupError,
  isValidBackupName,
  listBackups,
} from '@/lib/backup';

export const runtime = 'nodejs';
export const maxDuration = 900;

/**
 * GET    — download one backup to the operator's machine.
 * DELETE — remove one backup from the server.
 *
 * `name` always comes from a request, so it is checked against the strict
 * filename pattern before it is joined to a path: that is what stops `..` and
 * absolute paths from reaching anything outside the backup folder.
 */
async function resolve(nameRaw: string): Promise<string | null> {
  const name = decodeURIComponent(nameRaw);
  if (!isValidBackupName(name)) return null;
  const file = path.join(backupDir(), name);
  try {
    await fs.access(file);
    return file;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const { name: raw } = await ctx.params;
    const file = await resolve(raw);
    if (!file) return notFound('ไม่พบไฟล์สำรองนี้');
    const name = decodeURIComponent(raw);
    const { size } = await fs.stat(file);

    // Audited BEFORE the bytes leave: a dump is every record in the school,
    // including decryptable เลขบัตร and passwords. Who took a copy, and when,
    // has to be on the record even if the transfer is then interrupted.
    await recordAudit({
      session: guard.session,
      action: 'download_backup',
      targetType: 'backup',
      targetLabel: name,
      detail: `ดาวน์โหลดไฟล์สำรอง ${name} (${Math.round(size / 1024 / 1024)} MB)`,
      req,
    });

    // Streamed, not read into memory — these files are as large as the database.
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(size),
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleBackupError(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const { name: raw } = await ctx.params;
    const file = await resolve(raw);
    if (!file) return notFound('ไม่พบไฟล์สำรองนี้');
    const name = decodeURIComponent(raw);

    // Refuse to delete the only copy. Someone tidying up an old list should not
    // be able to leave the school with no backup at all in one click.
    const all = await listBackups();
    if (all.length <= 1) {
      return badRequest('นี่เป็นไฟล์สำรองไฟล์เดียวที่เหลืออยู่ — กรุณาสำรองข้อมูลใหม่ก่อนลบไฟล์นี้');
    }

    await deleteBackup(name);
    await recordAudit({
      session: guard.session,
      action: 'delete_backup',
      targetType: 'backup',
      targetLabel: name,
      detail: `ลบไฟล์สำรอง ${name}`,
      req,
    });
    return ok({ ok: true, deleted: name });
  } catch (err) {
    return handleBackupError(err);
  }
}

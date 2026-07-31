import type { NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { workers } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';
import {
  importPhotoFiles,
  precheckNames,
  MAX_PRECHECK_NAMES,
  type PhotoImportSpec,
} from '@/lib/services/photo-import';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/users/workers/photos — bulk-attach worker photos, matched by
 * filename ("W005.jpg" -> worker W005). Accepts either a JSON precheck
 * ({ names }) or a multipart upload; see the students twin for the flow.
 */
const spec: PhotoImportSpec = {
  codeField: 'workerCode',
  notFoundReason: 'ไม่พบรหัสคนงานนี้',
  async lookup(codes) {
    const rows = await db
      .select({ id: workers.id, code: workers.workerCode })
      .from(workers)
      .where(inArray(workers.workerCode, codes));
    return rows.map((r) => [r.code, r.id] as const);
  },
  async save(id, base64, mime) {
    await db
      .update(workers)
      .set({ photoBase64: base64, photoMime: mime })
      .where(eq(workers.id, id));
  },
};

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = (await req.json()) as { names?: unknown };
      const names = Array.isArray(body.names)
        ? body.names.filter((n): n is string => typeof n === 'string')
        : [];
      if (names.length === 0) return badRequest('กรุณาส่งรายชื่อไฟล์อย่างน้อย 1 รายการ');
      if (names.length > MAX_PRECHECK_NAMES) {
        return badRequest(`ตรวจได้สูงสุด ${MAX_PRECHECK_NAMES.toLocaleString()} ไฟล์ต่อครั้ง`);
      }
      return ok(await precheckNames(names, spec));
    }

    const form = await req.formData();
    const dryRun = String(form.get('dryRun') ?? 'true').toLowerCase() === 'true';
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) return badRequest('กรุณาแนบไฟล์รูปภาพอย่างน้อย 1 ไฟล์');

    const report = await importPhotoFiles(files, spec, dryRun);
    if (!dryRun) {
      await recordAudit({
        session: guard.session,
        action: 'import',
        targetType: 'worker',
        detail: `นำเข้ารูปคนงาน ${report.committed} รูป (ข้าม ${report.skipped})`,
        req,
      });
    }
    return ok({ ...report, dryRun });
  } catch (err) {
    return handleError(err);
  }
}

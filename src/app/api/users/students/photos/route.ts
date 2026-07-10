import type { NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { students } from '@/db/schema';
import { requireTeacherAdmin } from '@/lib/rbac';
import { ok, badRequest, handleError } from '@/lib/http';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * POST /api/users/students/photos   (multipart: files=<image>[, ...])
 *
 * Bulk-attach student photos by matching each file's name (minus extension) to
 * a student_code. e.g. "07822.jpg" -> student 07822. Reports matched / skipped
 * / unmatched. dryRun=true only reports (no writes).
 */
interface PhotoIssue {
  file: string;
  studentCode: string;
  reason: string;
}

/** Strip directory + extension, keep the code. Tolerates "07822 (1).jpg" etc. */
function codeFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const noExt = base.replace(/\.[^.]+$/, '');
  return noExt.trim();
}

export async function POST(req: NextRequest) {
  const guard = await requireTeacherAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const form = await req.formData();
    const dryRun = String(form.get('dryRun') ?? 'true').toLowerCase() === 'true';
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) return badRequest('กรุณาแนบไฟล์รูปภาพอย่างน้อย 1 ไฟล์');

    // Map each file to a student code up front.
    const wanted = new Map<string, File>(); // code -> file (last one wins)
    const issues: PhotoIssue[] = [];
    for (const f of files) {
      const code = codeFromFilename(f.name);
      if (!code) {
        issues.push({ file: f.name, studentCode: '-', reason: 'ชื่อไฟล์ว่าง' });
        continue;
      }
      if (!ALLOWED.has(f.type)) {
        issues.push({ file: f.name, studentCode: code, reason: 'ชนิดไฟล์ไม่รองรับ' });
        continue;
      }
      if (f.size > MAX_BYTES) {
        issues.push({ file: f.name, studentCode: code, reason: 'ไฟล์ใหญ่เกิน 5MB' });
        continue;
      }
      wanted.set(code, f);
    }

    // Which codes exist?
    const codes = [...wanted.keys()];
    const found = codes.length
      ? await db
          .select({ id: students.id, studentCode: students.studentCode })
          .from(students)
          .where(inArray(students.studentCode, codes))
      : [];
    const codeToId = new Map(found.map((r) => [r.studentCode, r.id]));

    const matched: string[] = [];
    for (const code of codes) {
      if (!codeToId.has(code)) {
        issues.push({ file: wanted.get(code)!.name, studentCode: code, reason: 'ไม่พบรหัสนักเรียนนี้' });
      } else {
        matched.push(code);
      }
    }

    const summary = { totalFiles: files.length, matched: matched.length, skipped: issues.length, dryRun };
    if (dryRun) return ok({ ...summary, committed: 0, issues });

    let committed = 0;
    for (const code of matched) {
      const f = wanted.get(code)!;
      const buf = Buffer.from(await f.arrayBuffer());
      await db
        .update(students)
        .set({ photoBase64: buf.toString('base64'), photoMime: f.type })
        .where(inArray(students.id, [codeToId.get(code)!]));
      committed++;
    }

    await recordAudit({
      session: guard.session,
      action: 'import',
      targetType: 'student',
      detail: `นำเข้ารูปนักเรียน ${committed} รูป (ข้าม ${issues.length})`,
      req,
    });

    return ok({ ...summary, committed, issues });
  } catch (err) {
    return handleError(err);
  }
}

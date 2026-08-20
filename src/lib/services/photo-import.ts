/**
 * Bulk profile-photo import, shared by นักเรียน / ครู / คนงาน / อาจารย์พิเศษ.
 *
 * Files are matched by name: the filename minus its extension must equal the
 * person's code ("07822.jpg" -> student 07822). The three routes differ only in
 * which table they read and what the "not found" line says, so everything else
 * — parsing, validation, duplicate handling, reporting — lives here.
 *
 * Two entry points, because a 4000-file import must not upload 4000 files just
 * to be told which ones match:
 *
 *   precheckNames()   filenames only, as JSON. One query, no bytes on the wire.
 *                     The client uses the returned `matchedNames` to decide what
 *                     is even worth cropping and uploading.
 *   importPhotoFiles() the real upload, sent in small batches by the client.
 *
 * Both return the same report shape, so the UI renders one table either way.
 */

/** Per-file ceiling. The client crops to ~50KB first; this is the backstop. */
export const MAX_BYTES = 5 * 1024 * 1024;

export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Codes per lookup query. Postgres copes with a far larger `in (...)`, but a
 * 4000-parameter statement is a needlessly large thing to plan and log.
 */
const LOOKUP_CHUNK = 500;

/** Filenames accepted in one precheck call — a school-sized ceiling, not a limit. */
export const MAX_PRECHECK_NAMES = 20_000;

type CodeField = 'studentCode' | 'teacherCode' | 'workerCode' | 'specialTeacherCode';

/** Report rows keep the module-specific code key the UI already reads. */
export type PhotoIssue = { file: string; reason: string } & Partial<Record<CodeField, string>>;

export interface PhotoImportReport {
  totalFiles: number;
  matched: number;
  skipped: number;
  committed: number;
  issues: PhotoIssue[];
}

export interface PhotoImportSpec {
  codeField: CodeField;
  /** e.g. 'ไม่พบรหัสนักเรียนนี้' */
  notFoundReason: string;
  /** Resolve codes to row ids. Only the codes that exist need come back. */
  lookup(codes: string[]): Promise<(readonly [string, number])[]>;
  /** Write one photo. Called once per matched file. */
  save(id: number, base64: string, mime: string): Promise<void>;
}

/** Strip directory + extension, keep the code. Tolerates "07822 (1).jpg" etc. */
export function codeFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[^.]+$/, '').trim();
}

interface Named {
  name: string;
  /** Present for real uploads, absent at precheck (nothing has been cropped yet). */
  type?: string;
  size?: number;
}

/**
 * Group candidates by the code in their filename, collecting rejects as issues.
 *
 * Two files claiming the same code is a real case (a re-scan, "07822.jpg" and a
 * copy) and the last one wins — but the loser is now REPORTED rather than
 * silently dropped, so `totalFiles` always equals matched + skipped and the
 * summary adds up.
 */
function bucketByCode<T extends Named>(
  items: T[],
  spec: PhotoImportSpec,
): { wanted: Map<string, T>; issues: PhotoIssue[] } {
  const wanted = new Map<string, T>();
  const issues: PhotoIssue[] = [];
  const issue = (file: string, code: string, reason: string) =>
    issues.push({ file, reason, [spec.codeField]: code } as PhotoIssue);

  for (const it of items) {
    const code = codeFromFilename(it.name);
    if (!code) {
      issue(it.name, '-', 'ชื่อไฟล์ว่าง');
      continue;
    }
    // type/size are only checked when the caller actually has the bytes.
    if (it.type !== undefined && !ALLOWED_MIME.has(it.type)) {
      issue(it.name, code, 'ชนิดไฟล์ไม่รองรับ');
      continue;
    }
    if (it.size !== undefined && it.size > MAX_BYTES) {
      issue(it.name, code, 'ไฟล์ใหญ่เกิน 5MB');
      continue;
    }
    const previous = wanted.get(code);
    if (previous) issue(previous.name, code, 'รหัสซ้ำกับไฟล์อื่น — ใช้ไฟล์ล่าสุดแทน');
    wanted.set(code, it);
  }
  return { wanted, issues };
}

/** Chunked code -> id resolution. */
async function resolveCodes(codes: string[], spec: PhotoImportSpec): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < codes.length; i += LOOKUP_CHUNK) {
    const pairs = await spec.lookup(codes.slice(i, i + LOOKUP_CHUNK));
    for (const [code, id] of pairs) out.set(code, id);
  }
  return out;
}

/** Split buckets into matched codes and "no such person" issues. */
function splitMatched<T extends Named>(
  wanted: Map<string, T>,
  found: Map<string, number>,
  spec: PhotoImportSpec,
): { matched: string[]; issues: PhotoIssue[] } {
  const matched: string[] = [];
  const issues: PhotoIssue[] = [];
  for (const [code, item] of wanted) {
    if (found.has(code)) matched.push(code);
    else issues.push({ file: item.name, reason: spec.notFoundReason, [spec.codeField]: code } as PhotoIssue);
  }
  return { matched, issues };
}

/**
 * Name-only dry run. Costs one indexed query per 500 names, so 4000 filenames
 * answer in well under a second — this is what makes "select all 4000 and let
 * the system sort it out" cheap instead of a 400MB upload.
 */
export async function precheckNames(
  names: string[],
  spec: PhotoImportSpec,
): Promise<PhotoImportReport & { matchedNames: string[] }> {
  const { wanted, issues } = bucketByCode(
    names.map((name) => ({ name })),
    spec,
  );
  const found = await resolveCodes([...wanted.keys()], spec);
  const split = splitMatched(wanted, found, spec);
  const allIssues = [...issues, ...split.issues];

  return {
    totalFiles: names.length,
    matched: split.matched.length,
    skipped: allIssues.length,
    committed: 0,
    issues: allIssues,
    matchedNames: split.matched.map((code) => wanted.get(code)!.name),
  };
}

/**
 * The real import. `dryRun` still reports without writing — kept so the older
 * one-shot flow (and any script posting multipart directly) behaves as before.
 *
 * Writes are sequential: a batch is small by construction (the client sizes it
 * to a few MB) and one UPDATE at a time keeps this from monopolising the pool
 * while other admins are using the module.
 */
export async function importPhotoFiles(
  files: File[],
  spec: PhotoImportSpec,
  dryRun: boolean,
): Promise<PhotoImportReport> {
  const { wanted, issues } = bucketByCode(files, spec);
  const found = await resolveCodes([...wanted.keys()], spec);
  const split = splitMatched(wanted, found, spec);
  const allIssues = [...issues, ...split.issues];

  const base = {
    totalFiles: files.length,
    matched: split.matched.length,
    skipped: allIssues.length,
    issues: allIssues,
  };
  if (dryRun) return { ...base, committed: 0 };

  let committed = 0;
  for (const code of split.matched) {
    const file = wanted.get(code)!;
    const buf = Buffer.from(await file.arrayBuffer());
    await spec.save(found.get(code)!, buf.toString('base64'), file.type);
    committed++;
  }
  return { ...base, committed };
}

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { badRequest, conflict, handleError } from './http';

/**
 * Database backup & restore.
 *
 * The whole module lives in one Postgres database — student and teacher
 * records, enrollments, the audit trail, API keys, and (because photos are
 * stored inline as base64, see students.photo_base64) every profile picture too.
 * So one `pg_dump` of that database IS the backup: there is no second store to
 * keep in step, and no writable media volume to remember.
 *
 * Format is pg_dump's custom format (`-Fc`): compressed, and restorable with
 * `pg_restore --single-transaction`, which is the property that matters — a
 * restore either lands completely or leaves the database exactly as it was.
 *
 * `pg_dump`/`pg_restore` are real binaries, added to the runtime image in the
 * Dockerfile (postgresql16-client, matching the postgres:16 server). Writing our
 * own dumper in JS was the alternative and was rejected: for the one operation
 * that has to work on the worst day of the year, the tool the database ships
 * with beats anything hand-rolled.
 */

/** Why a backup exists. Drives retention and how the UI labels it. */
export type BackupKind = 'auto' | 'manual' | 'upload' | 'prerestore';

export const KIND_LABEL_TH: Record<BackupKind, string> = {
  auto: 'อัตโนมัติ',
  manual: 'สำรองเอง',
  upload: 'อัปโหลด',
  prerestore: 'ก่อนกู้คืน',
};

/**
 * How many of each kind to keep. `auto` is the 14 nightly backups asked for:
 * the 15th night deletes the oldest, so the folder holds a rolling fortnight and
 * never grows without bound.
 *
 * The kinds are pruned SEPARATELY on purpose — a burst of manual backups before
 * a risky bulk import must not evict the nightly history, which is the one thing
 * nobody thinks to take by hand. Uploads are never pruned: someone deliberately
 * carried that file over, so only they should decide when it goes.
 */
export const RETENTION: Record<BackupKind, number> = {
  auto: keepCount('BACKUP_KEEP', 14),
  manual: keepCount('BACKUP_KEEP_MANUAL', 14),
  prerestore: keepCount('BACKUP_KEEP_PRERESTORE', 5),
  upload: Number.POSITIVE_INFINITY,
};

function keepCount(envName: string, fallback: number): number {
  const n = Number(process.env[envName]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const KINDS: BackupKind[] = ['auto', 'manual', 'upload', 'prerestore'];

/**
 * Where dumps live. In the container this is a bind mount to a folder on the
 * server (docker-compose.yml), so the files survive `docker compose down`, are
 * visible to whoever administers the machine, and can be copied to a NAS or a
 * USB stick without going through Docker.
 */
export function backupDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
}

/**
 * Filename carries everything the listing needs — timestamp and kind — so the
 * folder is readable on its own, sorts chronologically, and a listing still
 * works if the sidecar JSON beside it is ever lost.
 */
const FILE_RE = /^schoolos-users-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(auto|manual|upload|prerestore)\.dump$/;

const PART_SUFFIX = '.part';

export interface BackupFile {
  name: string;
  kind: BackupKind;
  /** ISO string; parsed from the filename, which is written in local time. */
  createdAt: string;
  bytes: number;
  /** Who pressed the button — null for the nightly run. */
  actor: string | null;
  note: string | null;
}

/** Sidecar written next to each dump: the bits a filename cannot carry. */
interface Sidecar {
  createdAt: string;
  kind: BackupKind;
  actor?: string | null;
  note?: string | null;
  durationMs?: number;
  /** Where it came from, for uploads. */
  originalName?: string;
}

const sidecarPath = (dir: string, name: string) => path.join(dir, `${name}.json`);

/** Local-time stamp, matching FILE_RE. Local because that is how people read it. */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function parseName(name: string): { kind: BackupKind; createdAt: Date } | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, kind] = m;
  return {
    kind: kind as BackupKind,
    createdAt: new Date(+y, +mo - 1, +d, +h, +mi, +s),
  };
}

/**
 * Guard for anything that takes a filename from a request. Only names this
 * module could itself have written are accepted, which rules out `..`, absolute
 * paths and every other way a caller might reach outside the backup folder.
 */
export function isValidBackupName(name: string): boolean {
  return FILE_RE.test(name);
}

/**
 * Pick a filename nothing else is using, and the timestamp that goes with it.
 *
 * The name is only accurate to the second, so two operations in the same second
 * — a manual backup while an upload lands, say — would otherwise choose the same
 * one. That is not a cosmetic clash: the loser's `.part` is renamed over the
 * winner's finished dump, and if the loser then fails validation its cleanup
 * deletes a backup that was perfectly good. So the second is advanced until both
 * the final name and its `.part` are free.
 *
 * Callers hold the exclusive slot, so nothing can claim the name in between.
 */
async function allocateName(
  dir: string,
  kind: BackupKind,
  startedAt: Date,
): Promise<{ name: string; createdAt: Date }> {
  for (let bump = 0; bump < 120; bump++) {
    const createdAt = new Date(startedAt.getTime() + bump * 1000);
    const name = `schoolos-users-${stamp(createdAt)}-${kind}.dump`;
    const taken = await Promise.all(
      [name, name + PART_SUFFIX].map((f) =>
        fs.access(path.join(dir, f)).then(
          () => true,
          () => false,
        ),
      ),
    );
    if (!taken.some(Boolean)) return { name, createdAt };
  }
  throw new BackupError('ตั้งชื่อไฟล์สำรองไม่ได้ — มีไฟล์ชื่อซ้ำจำนวนมากในโฟลเดอร์');
}

// ─── connection details ────────────────────────────────────────────────────

interface Dsn {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

function dsn(): Dsn {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new BackupError('DATABASE_URL is not set (see .env.example)');
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: u.port || '5432',
    // URL keeps these percent-encoded; pg wants the real bytes.
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

/** The database this app is pointed at — shown in the UI so a restore is not blind. */
export function databaseLabel(): string {
  try {
    const d = dsn();
    return `${d.database} @ ${d.host}:${d.port}`;
  } catch {
    return '-';
  }
}

// ─── running the postgres tools ────────────────────────────────────────────

/**
 * An operational failure the operator can act on — pg_dump missing, folder not
 * writable, file not a valid dump. Routes surface `message` verbatim instead of
 * the generic 500 text: on this page "ไม่พบคำสั่ง pg_dump" is the difference
 * between a five-minute fix and a mystery.
 */
export class BackupError extends Error {}

/**
 * Run a postgres client binary and resolve only on exit code 0.
 *
 * The password goes through PGPASSWORD in the child's environment rather than
 * into the DSN, so it never appears in an argument list (which `ps` would show
 * to anyone else on the box).
 */
function run(
  bin: string,
  args: string[],
  d: Dsn,
  timeoutMs: number,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, PGPASSWORD: d.password, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      // Cap it: a failing restore can produce a very long complaint.
      if (stderr.length < 8_000) stderr += c.toString('utf8');
    });
    child.stdout.resume();

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new BackupError(`${bin} ใช้เวลานานเกินกำหนด (${Math.round(timeoutMs / 1000)} วินาที)`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      reject(
        new BackupError(
          missing
            ? `ไม่พบคำสั่ง ${bin} ในเซิร์ฟเวอร์ — ต้อง build image ใหม่ (Dockerfile ติดตั้ง postgresql16-client)`
            : `เรียก ${bin} ไม่สำเร็จ: ${err.message}`,
        ),
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new BackupError(`${bin} ล้มเหลว (exit ${code})\n${stderr.trim()}`.trim()));
    });
  });
}

const connArgs = (d: Dsn) => ['-h', d.host, '-p', d.port, '-U', d.user, '-d', d.database];

/** Is the client tooling actually installed? Surfaced in the UI, not guessed at. */
export async function toolsAvailable(): Promise<boolean> {
  try {
    await run('pg_dump', ['--version'], { password: '' } as Dsn, 10_000);
    return true;
  } catch {
    return false;
  }
}

// ─── the backup folder ─────────────────────────────────────────────────────

export interface DirStatus {
  dir: string;
  exists: boolean;
  writable: boolean;
  /** Populated when it is NOT writable — the exact fix, not "check permissions". */
  hint: string | null;
}

/**
 * The app runs as an unprivileged user (uid 1001), while a freshly created bind
 * mount belongs to root — so "cannot write" is the expected first-run state on a
 * new server, not an exotic failure. Report it precisely enough to fix in one
 * command instead of letting the nightly run fail silently at midnight.
 */
export async function dirStatus(): Promise<DirStatus> {
  const dir = backupDir();
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    /* fall through to the access check, which produces the better message */
  }
  try {
    await fs.access(dir);
  } catch {
    return { dir, exists: false, writable: false, hint: `สร้างโฟลเดอร์ ${dir} บนเซิร์ฟเวอร์ก่อน` };
  }
  try {
    const probe = path.join(dir, `.write-test-${process.pid}`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    return { dir, exists: true, writable: true, hint: null };
  } catch {
    return {
      dir,
      exists: true,
      writable: false,
      hint:
        `โฟลเดอร์ ${dir} เขียนไม่ได้ — แอปทำงานด้วยผู้ใช้ uid 1001 ` +
        'บนเครื่อง server ให้รัน: sudo chown -R 1001:1001 <โฟลเดอร์ backups>',
    };
  }
}

export async function listBackups(): Promise<BackupFile[]> {
  const dir = backupDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const out: BackupFile[] = [];
  for (const name of names) {
    const parsed = parseName(name);
    if (!parsed) continue; // ignores sidecars, .part leftovers, stray files
    let bytes = 0;
    try {
      bytes = (await fs.stat(path.join(dir, name))).size;
    } catch {
      continue; // vanished between readdir and stat
    }
    const side = await readSidecar(dir, name);
    out.push({
      name,
      kind: parsed.kind,
      createdAt: (side?.createdAt ? new Date(side.createdAt) : parsed.createdAt).toISOString(),
      bytes,
      actor: side?.actor ?? null,
      note: side?.note ?? null,
    });
  }
  // Newest first — the one you want in a hurry is the one at the top.
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

async function readSidecar(dir: string, name: string): Promise<Sidecar | null> {
  try {
    return JSON.parse(await fs.readFile(sidecarPath(dir, name), 'utf8')) as Sidecar;
  } catch {
    return null; // a dump without its sidecar is still a perfectly good dump
  }
}

async function writeSidecar(dir: string, name: string, data: Sidecar): Promise<void> {
  try {
    await fs.writeFile(sidecarPath(dir, name), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[backup] could not write sidecar for', name, err);
  }
}

/**
 * Sweep away `.part` files left by a dump that was interrupted — a container
 * restart mid-backup, a full disk. They are invisible to the listing but still
 * occupy the space of a full dump each, so they are cleared at startup rather
 * than left to accumulate quietly until the disk fills.
 *
 * Only files older than the dump timeout are touched, so a backup running right
 * now is never pulled out from under itself.
 */
export async function cleanupPartials(): Promise<number> {
  const dir = backupDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  const cutoff = Date.now() - DUMP_TIMEOUT_MS;
  for (const name of names) {
    if (!name.endsWith(PART_SUFFIX)) continue;
    const file = path.join(dir, name);
    try {
      if ((await fs.stat(file)).mtimeMs > cutoff) continue;
      await fs.rm(file, { force: true });
      removed++;
    } catch {
      /* another process got there first, or it is not ours to remove */
    }
  }
  return removed;
}

export async function deleteBackup(name: string): Promise<void> {
  const dir = backupDir();
  await fs.unlink(path.join(dir, name));
  await fs.rm(sidecarPath(dir, name), { force: true });
}

/**
 * Drop the oldest backups of one kind past its retention count. Failures are
 * logged, never thrown: a full disk is a reason to shout, not a reason to
 * discard the backup that was just taken successfully.
 */
async function prune(kind: BackupKind): Promise<string[]> {
  const keep = RETENTION[kind];
  if (!Number.isFinite(keep)) return [];
  const mine = (await listBackups()).filter((b) => b.kind === kind);
  const doomed = mine.slice(keep); // listBackups() is newest-first
  const removed: string[] = [];
  for (const b of doomed) {
    try {
      await deleteBackup(b.name);
      removed.push(b.name);
    } catch (err) {
      console.error('[backup] could not prune', b.name, err);
    }
  }
  return removed;
}

// ─── one-at-a-time ─────────────────────────────────────────────────────────

/**
 * Backups and restores are serialised process-wide. Two concurrent dumps would
 * only fight over disk and CPU; a restore racing anything else is genuinely
 * dangerous. Callers get a clear "busy" instead of a queue.
 */
let inFlight: { what: string; since: number } | null = null;

export const currentOperation = () => inFlight;

async function exclusive<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight) {
    throw new BusyError(`มีงาน${inFlight.what}กำลังทำอยู่ กรุณารอให้เสร็จก่อน`);
  }
  inFlight = { what, since: Date.now() };
  try {
    return await fn();
  } finally {
    inFlight = null;
  }
}

export class BusyError extends Error {}

// ─── create ────────────────────────────────────────────────────────────────

const DUMP_TIMEOUT_MS = 15 * 60_000;
const RESTORE_TIMEOUT_MS = 30 * 60_000;

export interface CreateResult {
  file: BackupFile;
  pruned: string[];
  durationMs: number;
}

/**
 * Take a backup.
 *
 * The dump is written to `<name>.part` and renamed only on success, so a crash
 * or a full disk mid-dump leaves rubbish that the listing ignores rather than a
 * truncated file that looks restorable. That distinction is the entire value of
 * a backup system.
 */
export async function createBackup(opts: {
  kind: BackupKind;
  actor?: string | null;
  note?: string | null;
}): Promise<CreateResult> {
  return exclusive('สำรองข้อมูล', async () => {
    const status = await dirStatus();
    if (!status.writable) throw new BackupError(status.hint ?? 'โฟลเดอร์สำรองข้อมูลเขียนไม่ได้');

    const d = dsn();
    const startedAt = new Date();
    const { name, createdAt } = await allocateName(status.dir, opts.kind, startedAt);
    const finalPath = path.join(status.dir, name);
    const partPath = finalPath + PART_SUFFIX;

    try {
      await run(
        'pg_dump',
        [
          ...connArgs(d),
          '--format=custom',
          '--compress=6',
          // The dump is restored into the same single-role database it came
          // from, so ownership and grants are noise that only causes errors when
          // the restoring role differs.
          '--no-owner',
          '--no-privileges',
          '--file',
          partPath,
        ],
        d,
        DUMP_TIMEOUT_MS,
      );
      await fs.rename(partPath, finalPath);
    } catch (err) {
      await fs.rm(partPath, { force: true });
      throw err;
    }

    const durationMs = Date.now() - startedAt.getTime();
    // The sidecar records the timestamp the FILENAME carries, not the wall clock
    // — they differ only when a name collision pushed the second forward, and
    // the listing must not then show two different times for one file.
    await writeSidecar(status.dir, name, {
      createdAt: createdAt.toISOString(),
      kind: opts.kind,
      actor: opts.actor ?? null,
      note: opts.note ?? null,
      durationMs,
    });

    const pruned = await prune(opts.kind);
    const bytes = (await fs.stat(finalPath)).size;
    return {
      file: {
        name,
        kind: opts.kind,
        createdAt: createdAt.toISOString(),
        bytes,
        actor: opts.actor ?? null,
        note: opts.note ?? null,
      },
      pruned,
      durationMs,
    };
  });
}

// ─── verify ────────────────────────────────────────────────────────────────

/** Every pg_dump custom-format file starts with this. Cheap first gate. */
const MAGIC = Buffer.from('PGDMP', 'ascii');

async function hasDumpMagic(file: string): Promise<boolean> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await fh.read(buf, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && buf.equals(MAGIC);
  } finally {
    await fh.close();
  }
}

/**
 * Is this file something pg_restore can actually read? `pg_restore --list` walks
 * the archive's table of contents without touching the database, so it is a real
 * integrity check and a safe one. Run before every restore, and on upload — the
 * moment to find out a file is corrupt is while the database is still fine.
 */
export async function verifyDump(name: string): Promise<void> {
  const file = path.join(backupDir(), name);
  if (!(await hasDumpMagic(file))) {
    throw new BackupError('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของ PostgreSQL (pg_dump custom format)');
  }
  await run('pg_restore', ['--list', file], dsn(), 60_000);
}

// ─── upload ────────────────────────────────────────────────────────────────

/**
 * Store a dump uploaded from someone's machine, e.g. after the server itself had
 * to be rebuilt. Streamed to disk rather than buffered — a dump with photos in
 * it is far too big to hold in memory.
 */
export async function saveUploadedBackup(
  body: ReadableStream<Uint8Array>,
  opts: { originalName?: string; actor?: string | null; maxBytes: number },
): Promise<BackupFile> {
  return exclusive('อัปโหลดไฟล์สำรอง', async () => {
    const status = await dirStatus();
    if (!status.writable) throw new BackupError(status.hint ?? 'โฟลเดอร์สำรองข้อมูลเขียนไม่ได้');

    // allocateName() guarantees this name belongs to nobody else, which is what
    // makes the cleanup below safe: a rejected upload deletes only its own file,
    // never an existing backup that happened to be created in the same second.
    const { name, createdAt } = await allocateName(status.dir, 'upload', new Date());
    const finalPath = path.join(status.dir, name);
    const partPath = finalPath + PART_SUFFIX;

    let bytes = 0;
    try {
      const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
      source.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > opts.maxBytes) source.destroy(new BackupError('ไฟล์ใหญ่เกินกำหนด'));
      });
      await pipeline(source, createWriteStream(partPath));
      await fs.rename(partPath, finalPath);
      // Only now is it a backup: reject anything pg_restore cannot read, so a
      // wrong file cannot sit in the list looking like a safety net.
      await verifyDump(name);
    } catch (err) {
      await fs.rm(partPath, { force: true });
      await fs.rm(finalPath, { force: true });
      throw err;
    }

    await writeSidecar(status.dir, name, {
      createdAt: createdAt.toISOString(),
      kind: 'upload',
      actor: opts.actor ?? null,
      originalName: opts.originalName,
      note: opts.originalName ? `อัปโหลดจากไฟล์ ${opts.originalName}` : null,
    });

    return {
      name,
      kind: 'upload',
      createdAt: createdAt.toISOString(),
      bytes,
      actor: opts.actor ?? null,
      note: opts.originalName ? `อัปโหลดจากไฟล์ ${opts.originalName}` : null,
    };
  });
}

// ─── restore ───────────────────────────────────────────────────────────────

export interface RestoreResult {
  restored: string;
  /** The safety copy taken of the CURRENT data, just before overwriting it. */
  safetyBackup: string | null;
  durationMs: number;
}

/**
 * Replace the entire database with the contents of a backup.
 *
 * Two things make this survivable:
 *
 *   `--single-transaction` — the drops and the reloads happen in one
 *   transaction, so a failure halfway through rolls back and the database is
 *   left exactly as it was. Never restore without it.
 *
 *   a safety backup of the current data first — taken even when the operator is
 *   sure, because "restored the wrong file" is the mistake this feature makes
 *   possible and it must be undoable.
 */
export async function restoreBackup(
  name: string,
  opts: { actor?: string | null } = {},
): Promise<RestoreResult> {
  const startedAt = Date.now();

  // Take the safety copy BEFORE claiming the exclusive slot — createBackup
  // claims it too, and it must finish before the restore begins anyway.
  const safety = await createBackup({
    kind: 'prerestore',
    actor: opts.actor ?? null,
    note: `สำรองอัตโนมัติก่อนกู้คืนจาก ${name}`,
  });

  return exclusive('กู้คืนข้อมูล', async () => {
    await verifyDump(name);
    const d = dsn();
    await run(
      'pg_restore',
      [
        ...connArgs(d),
        // Drop what is there before reloading, tolerating objects the dump
        // knows about but this database does not (and vice versa).
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        // All or nothing. Implies --exit-on-error.
        '--single-transaction',
        path.join(backupDir(), name),
      ],
      d,
      RESTORE_TIMEOUT_MS,
      {
        // The app keeps a pool of idle connections; idle ones hold no locks, so
        // DROP goes through. If something IS holding a table (a long export, a
        // second admin mid-import), fail in a minute with a clear error rather
        // than blocking on a lock for half an hour.
        PGOPTIONS: '-c lock_timeout=60s -c statement_timeout=0',
      },
    );
    return {
      restored: name,
      safetyBackup: safety.file.name,
      durationMs: Date.now() - startedAt,
    };
  });
}

// ─── nightly run status ────────────────────────────────────────────────────

/**
 * Outcome of the last scheduled run, kept as a file in the backup folder rather
 * than a database table — precisely so that restoring the database cannot
 * rewrite the backup system's own history, and so a failure is still readable
 * when the database is the thing that is broken.
 */
export interface RunStatus {
  lastRunAt: string | null;
  ok: boolean | null;
  file: string | null;
  error: string | null;
}

const STATUS_FILE = '_last-run.json';

export async function readRunStatus(): Promise<RunStatus> {
  try {
    const raw = await fs.readFile(path.join(backupDir(), STATUS_FILE), 'utf8');
    return JSON.parse(raw) as RunStatus;
  } catch {
    return { lastRunAt: null, ok: null, file: null, error: null };
  }
}

export async function writeRunStatus(status: RunStatus): Promise<void> {
  try {
    await fs.writeFile(
      path.join(backupDir(), STATUS_FILE),
      JSON.stringify(status, null, 2),
      'utf8',
    );
  } catch (err) {
    console.error('[backup] could not write run status', err);
  }
}

/** All the kinds, for the UI's filter — exported so the list cannot drift. */
export const BACKUP_KINDS = KINDS;

/**
 * Map a backup failure onto a response. Operational problems keep their own
 * message (they name the fix), a clash returns 409, and anything genuinely
 * unexpected falls back to the generic handler so it is logged, not leaked.
 */
export function handleBackupError(err: unknown) {
  if (err instanceof BusyError) return conflict(err.message);
  if (err instanceof BackupError) {
    console.error('[backup]', err.message);
    return badRequest(err.message);
  }
  return handleError(err);
}

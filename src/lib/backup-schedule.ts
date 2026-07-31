import { cleanupPartials, createBackup, dirStatus, writeRunStatus } from './backup';

/**
 * The nightly backup: one run at midnight, every night, in the school's own
 * timezone.
 *
 * Deliberately an in-process timer rather than a cron container or a compose
 * service. Three reasons: the manual button and the scheduled run then execute
 * the exact same code path (so the thing that runs unattended at 00:00 is the
 * thing that was tested at 10:00); nothing new has to be given database
 * credentials; and a failed scheduled run cannot take the deploy down, which is
 * a lesson this stack already learned the hard way with its bootstrap service.
 *
 * The trade-off is that the app must be running at midnight — for a school
 * server that is up continuously, it is. If the container was down, the run is
 * simply missed; it is not made up on the next boot, because a backup taken at a
 * surprising moment is worse than an obvious gap in the list.
 */

/** Survives Next.js dev HMR, which re-imports modules and would stack timers. */
const globalForSchedule = globalThis as unknown as {
  __schoolosBackupTimer?: ReturnType<typeof setTimeout>;
  __schoolosBackupNextRun?: number;
};

function enabled(): boolean {
  return (process.env.BACKUP_SCHEDULE ?? 'on').toLowerCase() !== 'off';
}

function timezone(): string {
  return process.env.BACKUP_TZ || 'Asia/Bangkok';
}

/** "HH:MM", default midnight. */
function timeOfDay(): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(process.env.BACKUP_TIME ?? '00:00');
  if (!m) return { hour: 0, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));
  return { hour, minute };
}

/**
 * How far `tz` is ahead of UTC at instant `at`, in ms.
 *
 * Computed by formatting the instant in that zone and reading the wall clock
 * back, because the container's own TZ is usually UTC and "midnight" has to mean
 * midnight in Thailand regardless.
 */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    // en-US with hour12:false renders midnight as "24"; normalise it.
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - at.getTime();
}

/** The next occurrence of BACKUP_TIME in BACKUP_TZ, strictly after `from`. */
export function nextRunAt(from: Date = new Date()): Date {
  const tz = timezone();
  const { hour, minute } = timeOfDay();
  const offset = tzOffsetMs(from, tz);

  // Shift into "local" numbers so the day arithmetic can be done in UTC helpers.
  const local = new Date(from.getTime() + offset);
  const target = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute, 0, 0),
  );
  if (target.getTime() <= local.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return new Date(target.getTime() - offset);
}

/** What the UI shows: when the next nightly run is due, or null if disabled. */
export function scheduleInfo(): {
  enabled: boolean;
  time: string;
  tz: string;
  nextRunAt: string | null;
} {
  const { hour, minute } = timeOfDay();
  const on = enabled();
  return {
    enabled: on,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    tz: timezone(),
    nextRunAt: on ? new Date(globalForSchedule.__schoolosBackupNextRun ?? nextRunAt()).toISOString() : null,
  };
}

async function runScheduledBackup(): Promise<void> {
  try {
    const result = await createBackup({ kind: 'auto', note: 'สำรองอัตโนมัติตามกำหนดเวลา' });
    await writeRunStatus({
      lastRunAt: new Date().toISOString(),
      ok: true,
      file: result.file.name,
      error: null,
    });
    console.log(
      `[backup] nightly backup ok: ${result.file.name} (${result.file.bytes} bytes` +
        `${result.pruned.length ? `, pruned ${result.pruned.length}` : ''})`,
    );
  } catch (err) {
    // Never throw out of the timer: an unhandled rejection here would take the
    // server process with it, turning "tonight's backup failed" into "the school
    // records system is down".
    const message = err instanceof Error ? err.message : String(err);
    console.error('[backup] nightly backup FAILED:', message);
    await writeRunStatus({
      lastRunAt: new Date().toISOString(),
      ok: false,
      file: null,
      error: message,
    });
  }
}

function schedule(): void {
  const at = nextRunAt();
  globalForSchedule.__schoolosBackupNextRun = at.getTime();
  clearTimeout(globalForSchedule.__schoolosBackupTimer);
  globalForSchedule.__schoolosBackupTimer = setTimeout(async () => {
    await runScheduledBackup();
    schedule(); // chain the next night
  }, Math.max(1000, at.getTime() - Date.now()));
}

/** Called once at server startup (src/instrumentation.ts). */
export async function startBackupSchedule(): Promise<void> {
  if (!enabled()) {
    console.log('[backup] nightly schedule disabled (BACKUP_SCHEDULE=off)');
    return;
  }
  if (globalForSchedule.__schoolosBackupTimer) return; // already armed

  schedule();
  const at = new Date(globalForSchedule.__schoolosBackupNextRun!);
  console.log(`[backup] nightly backup armed for ${at.toISOString()} (${timezone()})`);

  // Say so at BOOT if the folder is unusable, rather than letting it be
  // discovered at midnight by nobody.
  const status = await dirStatus();
  if (!status.writable) {
    console.error('[backup]', status.hint);
    return;
  }

  // A restart is exactly when a half-written dump from the previous run is
  // lying around; this is the moment to clear it.
  const swept = await cleanupPartials();
  if (swept) console.log(`[backup] cleaned up ${swept} interrupted backup file(s)`);
}

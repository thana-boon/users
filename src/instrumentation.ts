/**
 * Next.js startup hook — runs once per server instance.
 *
 * Used to bootstrap the first teacher-admin so a freshly deployed server is
 * reachable without a manual step (see src/lib/bootstrap.ts), to fill the
 * กลุ่มสาระ picker from the names the rosters already carry (see
 * src/lib/services/subject-groups.ts), and to arm the nightly database backup
 * (see src/lib/backup-schedule.ts).
 *
 * The import MUST stay inside the `=== 'nodejs'` block, not after an early
 * return. This file is compiled for the edge runtime too (the project has
 * middleware), and Next inlines NEXT_RUNTIME per compilation so webpack can
 * dead-code-eliminate the whole branch. Outside the block the import is still
 * traced and the edge build fails with:
 *   UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureAdminBootstrap } = await import('@/lib/bootstrap');
    await ensureAdminBootstrap();

    // Before anything can read the picker, and specifically before an admin
    // can open a teacher and re-save them: the dropdown must already contain
    // the value that teacher is carrying, or saving would move them.
    const { ensureSubjectGroups } = await import('@/lib/services/subject-groups');
    await ensureSubjectGroups();

    const { startBackupSchedule } = await import('@/lib/backup-schedule');
    await startBackupSchedule();
  }
}

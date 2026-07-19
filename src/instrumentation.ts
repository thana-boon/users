/**
 * Next.js startup hook — runs once per server instance.
 *
 * Used to bootstrap the first teacher-admin so a freshly deployed server is
 * reachable without a manual step (see src/lib/bootstrap.ts).
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
  }
}

import { and, eq, sql as dsql } from 'drizzle-orm';
import { db } from '@/db';
import { teachers } from '@/db/schema';
import { encrypt } from '@/lib/crypto';

/**
 * First-run bootstrap of the initial `teacher-admin`.
 *
 * This module is admin-only: with an empty `teachers` table nobody can log in,
 * and the staff import itself needs a login — a chicken-and-egg on a fresh
 * server. Called once from `src/instrumentation.ts` when the server boots.
 *
 * Deliberately narrower than `scripts/create-admin.ts`: it acts ONLY when the
 * database contains no active teacher-admin at all, and never touches an
 * existing account. So it cannot reset a password that someone has since
 * changed, and re-deploying is a no-op once a real admin exists. To reset a
 * forgotten password, run the script explicitly:
 *   docker compose run --rm seed-admin
 *
 * Never throws: a bootstrap failure must not take the whole app down (that is
 * exactly what the old deploy-time `seed-admin` service did). It logs instead.
 */

let ran = false;

export async function ensureAdminBootstrap(): Promise<void> {
  if (ran) return; // one attempt per server process
  ran = true;

  try {
    const [row] = await db
      .select({ n: dsql<number>`count(*)::int` })
      .from(teachers)
      .where(and(eq(teachers.role, 'teacher-admin'), eq(teachers.isArchived, false)));

    if ((row?.n ?? 0) > 0) return; // an admin already exists — do nothing, quietly

    const code = process.env.SEED_ADMIN_CODE?.trim();
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!code || !password) {
      console.warn(
        '[bootstrap] no teacher-admin exists and SEED_ADMIN_CODE / SEED_ADMIN_PASSWORD ' +
          'are not set — nobody can log in. Set them in .env and restart, or run: ' +
          'docker compose run --rm seed-admin',
      );
      return;
    }

    const [firstName, ...rest] = (process.env.SEED_ADMIN_NAME?.trim() || 'ผู้ดูแล ระบบ').split(
      /\s+/,
    );

    // onConflictDoNothing guards the (unlikely) race of two server processes
    // booting at once, and the case where the code exists as a plain teacher.
    await db
      .insert(teachers)
      .values({
        teacherCode: code,
        role: 'teacher-admin',
        firstName,
        lastName: rest.join(' ') || 'ระบบ',
        passwordEncrypted: encrypt(password),
      })
      .onConflictDoNothing({ target: teachers.teacherCode });

    console.log(`[bootstrap] created initial teacher-admin "${code}" — log in at /login`);
  } catch (err) {
    console.error('[bootstrap] admin bootstrap skipped:', err);
  }
}

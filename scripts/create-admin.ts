/**
 * Bootstrap / promote a `teacher-admin` account so someone can actually enter
 * this admin-only module. Solves the chicken-and-egg on a fresh server: the UI
 * import needs a login, but a login needs a `teacher-admin` in the DB first.
 *
 *   npm run admin:create -- T00001 "myPassword" "ชื่อ นามสกุล"
 *   npm run admin:create -- T00001 "myPassword"          # name optional
 *
 * With no arguments it falls back to SEED_ADMIN_CODE / SEED_ADMIN_PASSWORD /
 * SEED_ADMIN_NAME from the environment — that is how the one-shot `seed-admin`
 * compose service bootstraps a login on `docker compose up`, unattended.
 *
 * If the teacher_code already exists it is PROMOTED to teacher-admin and (if a
 * password is given) its password is reset. Password is stored AES-256-GCM
 * encrypted, same as every other credential. Re-running is therefore safe.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, sql } from '../src/db';
import { teachers } from '../src/db/schema';
import { encrypt } from '../src/lib/crypto';

async function main() {
  const [argCode, argPassword, ...argName] = process.argv.slice(2);
  const code = argCode || process.env.SEED_ADMIN_CODE;
  const password = argPassword || process.env.SEED_ADMIN_PASSWORD;
  const name = argName.join(' ') || process.env.SEED_ADMIN_NAME;
  if (!code || !password) {
    console.error(
      'Usage: npm run admin:create -- <teacher_code> <password> [full name]\n' +
        '   or: set SEED_ADMIN_CODE and SEED_ADMIN_PASSWORD in the environment',
    );
    process.exit(1);
  }
  const teacherCode = code.trim();
  const [firstName, ...rest] = (name?.trim() || 'ผู้ดูแล ระบบ').split(/\s+/);
  const lastName = rest.join(' ') || 'ระบบ';

  const existing = await db.query.teachers.findFirst({
    where: eq(teachers.teacherCode, teacherCode),
    columns: { id: true },
  });

  if (existing) {
    await db
      .update(teachers)
      .set({ role: 'teacher-admin', passwordEncrypted: encrypt(password), isArchived: false })
      .where(eq(teachers.id, existing.id));
    console.log(`[admin] promoted ${teacherCode} -> teacher-admin (password reset)`);
  } else {
    await db.insert(teachers).values({
      teacherCode,
      role: 'teacher-admin',
      firstName,
      lastName,
      passwordEncrypted: encrypt(password),
    });
    console.log(`[admin] created ${teacherCode} as teacher-admin`);
  }

  console.log(`[admin] login at /login with รหัสครู="${teacherCode}" and the password you set.`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

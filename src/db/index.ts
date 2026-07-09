import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Single shared PostgreSQL client. In dev, cache on globalThis so Next.js HMR
 * doesn't open a new pool on every reload.
 */
const globalForDb = globalThis as unknown as {
  __schoolosSql?: ReturnType<typeof postgres>;
};

function makeClient() {
  const url =
    process.env.DATABASE_URL ??
    'postgres://schoolos:schoolos@localhost:5002/users';
  return postgres(url, { max: 10 });
}

export const sql = globalForDb.__schoolosSql ?? makeClient();
if (process.env.NODE_ENV !== 'production') globalForDb.__schoolosSql = sql;

export const db = drizzle(sql, { schema });
export { schema };

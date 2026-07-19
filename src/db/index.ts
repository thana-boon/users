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

type Sql = ReturnType<typeof postgres>;

function makeClient(): Sql {
  // No fallback DSN: the DB is the shared postgres-core server and its
  // credentials live only in .env / the compose environment, never in git.
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  const client = postgres(url, { max: 10 });
  if (process.env.NODE_ENV !== 'production') globalForDb.__schoolosSql = client;
  return client;
}

/**
 * Created on first touch, not on import. `next build` imports every route
 * module to collect page data, and it does so WITHOUT the runtime env — so
 * constructing (and therefore validating DATABASE_URL) eagerly would fail the
 * production build. Deferring keeps the missing-env error loud but moves it to
 * the first actual query, where the env is real.
 */
let client: Sql | undefined;
const resolve = (): Sql => (client ??= globalForDb.__schoolosSql ?? makeClient());

export const sql = new Proxy((() => {}) as unknown as Sql, {
  // `sql` is callable — the tagged-template query form: sql`select 1`.
  apply: (_t, thisArg, args) =>
    Reflect.apply(resolve() as unknown as (...a: unknown[]) => unknown, thisArg, args),
  get: (_t, prop, receiver) => Reflect.get(resolve(), prop, receiver),
  set: (_t, prop, value, receiver) => Reflect.set(resolve(), prop, value, receiver),
  has: (_t, prop) => Reflect.has(resolve(), prop),
});

// Same deferral for the Drizzle instance: drizzle() reads the client's options
// on construction, which would resolve `sql` at import and defeat the above.
type Db = ReturnType<typeof drizzle<typeof schema>>;
let dbInstance: Db | undefined;
const resolveDb = (): Db => (dbInstance ??= drizzle(resolve(), { schema }));

export const db = new Proxy({} as Db, {
  get: (_t, prop, receiver) => Reflect.get(resolveDb(), prop, receiver),
  set: (_t, prop, value, receiver) => Reflect.set(resolveDb(), prop, value, receiver),
  has: (_t, prop) => Reflect.has(resolveDb(), prop),
});

export { schema };

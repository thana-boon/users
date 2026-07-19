import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// No fallback DSN — credentials for the shared postgres-core server come from
// the environment only (.env on the host, compose env in the migrate service).
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});

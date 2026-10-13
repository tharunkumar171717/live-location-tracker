// A self-contained backend for end-to-end tests and offline demos:
// embedded Postgres (unless DATABASE_URL is set), local migrations, and the
// API with HS256 test tokens instead of a real Supabase project.
//
//   node scripts/e2e-server.js            # port 4100
//   E2E_PORT=4000 node scripts/e2e-server.js
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = Number(process.env.E2E_PORT || 4100);
const cleanups = [];

if (!process.env.DATABASE_URL) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dir = await mkdtemp(path.join(tmpdir(), 'llt-e2e-pg-'));
  const pgPort = port + 1000;
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${pgPort}/postgres`;
  cleanups.push(async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  });
}

Object.assign(process.env, {
  DB_SSL: 'false',
  SUPABASE_URL: process.env.SUPABASE_URL || 'http://localhost:54321',
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || 'e2e',
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET || 'e2e-jwt-secret-at-least-32-characters',
  CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:3100',
  DEMO_TICK_MS: process.env.DEMO_TICK_MS || '1000',
  LOCATION_MIN_INTERVAL_MS: process.env.LOCATION_MIN_INTERVAL_MS || '500',
  HTTP_PUBLIC_RATE_PER_MIN: process.env.HTTP_PUBLIC_RATE_PER_MIN || '1000',
  RETENTION_ENABLED: 'false',
  LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
});

const { pool } = await import('../src/db.js');
const { migrate } = await import('../src/migrations.js');
await migrate(pool, { local: true });

const { createServer } = await import('../src/app.js');
const instance = await createServer();
await instance.listen(port);
console.log(`e2e server on http://localhost:${port}`);

async function shutdown() {
  await instance.close();
  await pool.end();
  for (const fn of cleanups) await fn();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

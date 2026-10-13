// Starts real Postgres and Redis once per test run, unless CI already
// provides them (TEST_DATABASE_URL / TEST_REDIS_URL from service containers).
// Locally they come from npm (embedded-postgres, redis-memory-server), so the
// suite needs no Docker and no system installs.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';

const freePort = () =>
  new Promise((resolve) => {
    const srv = createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

export default async function setup({ provide }) {
  const cleanups = [];

  let databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const dir = await mkdtemp(path.join(tmpdir(), 'llt-pg-'));
    const port = await freePort();
    const server = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'postgres',
      password: 'postgres',
      port,
      persistent: false,
      onLog: () => {},
    });
    await server.initialise();
    await server.start();
    databaseUrl = `postgres://postgres:postgres@localhost:${port}/postgres`;
    cleanups.push(async () => {
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    });
  }

  // Fresh schema every run.
  const { migrate } = await import('../src/migrations.js');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  await pool.query('drop schema if exists public cascade; create schema public; drop schema if exists auth cascade');
  await migrate(pool, { local: true });
  await pool.end();

  let redisUrl = process.env.TEST_REDIS_URL;
  if (!redisUrl) {
    const { RedisMemoryServer } = await import('redis-memory-server');
    const redis = await RedisMemoryServer.create();
    redisUrl = `redis://${await redis.getHost()}:${await redis.getPort()}`;
    cleanups.push(() => redis.stop());
  }

  provide('databaseUrl', databaseUrl);
  provide('redisUrl', redisUrl);

  return async () => {
    for (const fn of cleanups.reverse()) await fn();
  };
}

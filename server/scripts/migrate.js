// npm run migrate            -> Supabase (or any Postgres that already has the auth schema)
// npm run migrate -- --local -> plain Postgres (tests, docker compose)
import { pool } from '../src/db.js';
import { migrate } from '../src/migrations.js';

try {
  await migrate(pool, { local: process.argv.includes('--local'), log: console.log });
  console.log('migrations up to date');
} finally {
  await pool.end();
}

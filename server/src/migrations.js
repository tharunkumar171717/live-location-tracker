// Applies db/migrations/*.sql in order, recording each in public.schema_migrations.
// With {local:true}, first applies db/local/*.sql (a stand-in for the Supabase
// `auth` schema) so the same migrations run on a plain Postgres.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');

async function sqlFiles(dir) {
  return (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
}

export async function migrate(pool, { local = false, log = () => {} } = {}) {
  const client = await pool.connect();
  try {
    if (local) {
      for (const file of await sqlFiles(path.join(root, 'local'))) {
        await client.query(await readFile(path.join(root, 'local', file), 'utf8'));
      }
    }

    await client.query(
      `create table if not exists public.schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const { rows } = await client.query('select name from public.schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    const dir = path.join(root, 'migrations');
    for (const file of await sqlFiles(dir)) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into public.schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        log(`applied ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`${file}: ${err.message}`, { cause: err });
      }
    }
  } finally {
    client.release();
  }
}

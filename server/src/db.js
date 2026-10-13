import pg from 'pg';
import { config } from './config.js';

const { connectionString, ...discrete } = config.db;

export const pool = new pg.Pool(
  connectionString
    ? { connectionString, ssl: config.db.ssl, max: 10 }
    : { ...discrete, max: 10 },
);

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

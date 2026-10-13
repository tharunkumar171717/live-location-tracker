// location_history grows by one row per member per second while sharing.
// This job keeps it bounded:
//   1. points older than RETENTION_KEEP_DAYS are deleted
//   2. points older than RETENTION_DOWNSAMPLE_AFTER_DAYS are thinned to the
//      first point per user per minute (replay still shows the route)
//   3. demo sessions' history is dropped after RETENTION_DEMO_KEEP_HOURS, and
//      ended guest demos are deleted outright
// Work is done in batches so no single statement holds locks for long, and a
// Postgres advisory lock makes sure only one instance runs it at a time.
import { config } from '../config.js';
import { pool } from '../db.js';
import { logger } from '../logger.js';
import { metrics } from '../metrics.js';
import { PUBLIC_DEMO_ID } from '../demo/simulator.js';

const LOCK_KEY = 74_210_001; // arbitrary, unique to this job
const BATCH = 5000;
const log = logger.child({ component: 'retention' });

async function inBatches(client, sql, params) {
  let total = 0;
  for (;;) {
    const { rowCount } = await client.query(sql, params);
    total += rowCount;
    if (rowCount < BATCH) return total;
  }
}

export async function runRetention({ now = new Date() } = {}) {
  const { keepDays, downsampleAfterDays, demoKeepHours } = config.retention;
  const client = await pool.connect();
  try {
    const { rows } = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
    if (!rows[0].ok) return { skipped: true };
    try {
      const deleteBefore = new Date(now - keepDays * 86_400_000);
      const thinBefore = new Date(now - downsampleAfterDays * 86_400_000);
      const demoBefore = new Date(now - demoKeepHours * 3_600_000);

      const expired = await inBatches(
        client,
        `delete from public.location_history
          where id in (select id from public.location_history where recorded_at < $1 limit ${BATCH})`,
        [deleteBefore],
      );

      const thinned = await inBatches(
        client,
        `delete from public.location_history
          where id in (
            select id from (
              select id, row_number() over (
                       partition by session_id, user_id, date_trunc('minute', recorded_at)
                       order by recorded_at) as rn
                from public.location_history
               where recorded_at < $1 and recorded_at >= $2
            ) x
            where rn > 1
            limit ${BATCH})`,
        [thinBefore, deleteBefore],
      );

      const demo = await inBatches(
        client,
        `delete from public.location_history
          where id in (
            select h.id from public.location_history h
              join public.tracking_sessions s on s.id = h.session_id
             where s.is_demo and h.recorded_at < $1
             limit ${BATCH})`,
        [demoBefore],
      );

      const { rowCount: demoSessions } = await client.query(
        `delete from public.tracking_sessions
          where is_demo and id <> $1 and status = 'ended' and ended_at < $2`,
        [PUBLIC_DEMO_ID, demoBefore],
      );

      metrics.retentionDeleted.inc({ reason: 'expired' }, expired);
      metrics.retentionDeleted.inc({ reason: 'downsampled' }, thinned);
      metrics.retentionDeleted.inc({ reason: 'demo' }, demo);
      const result = { expired, thinned, demo, demoSessions };
      log.info(result, 'retention run complete');
      return result;
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export function scheduleRetention() {
  if (!config.retention.enabled) return () => {};
  const run = () => runRetention().catch((err) => log.error({ err }, 'retention run failed'));
  const first = setTimeout(run, 60_000); // let the server settle after boot
  const every = setInterval(run, config.retention.intervalMs);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

import { config } from '../config.js';
import { query } from '../db.js';
import { metrics } from '../metrics.js';
import { logger } from '../logger.js';
import { HttpError, getMembership } from './sessions.js';

function finiteOrNull(value) {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? null : n;
}

const MAX_PAST_MS = 24 * 3600_000; // offline batches may be up to a day old
const MAX_FUTURE_MS = 60_000;

export function parseLocation(input, now = Date.now()) {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'Invalid lat');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, 'Invalid lng');

  // Trust the device timestamp only within a sane window around server time.
  let recordedAt = input?.timestamp ? new Date(input.timestamp).getTime() : now;
  if (!Number.isFinite(recordedAt) || recordedAt > now + MAX_FUTURE_MS || recordedAt < now - MAX_PAST_MS) {
    recordedAt = now;
  }

  const accuracy = finiteOrNull(input?.accuracy);
  const heading = finiteOrNull(input?.heading);
  const speed = finiteOrNull(input?.speed);
  return {
    lat,
    lng,
    accuracy: accuracy != null && accuracy >= 0 ? accuracy : null,
    heading: heading != null && heading >= 0 && heading <= 360 ? heading : null,
    speed: speed != null && speed >= 0 ? speed : null,
    recordedAt: new Date(recordedAt),
  };
}

// Keep points at least `minGapMs` apart (by device time), oldest first.
export function thinByTime(points, minGapMs) {
  const sorted = [...points].sort((a, b) => a.recordedAt - b.recordedAt);
  const kept = [];
  for (const p of sorted) {
    if (!kept.length || p.recordedAt - kept[kept.length - 1].recordedAt >= minGapMs) kept.push(p);
  }
  return kept;
}

function toEvent(sessionId, userId, loc) {
  return {
    sessionId,
    userId,
    lat: loc.lat,
    lng: loc.lng,
    accuracy: loc.accuracy,
    heading: loc.heading,
    speed: loc.speed,
    recordedAt: loc.recordedAt.toISOString(),
  };
}

// One per server instance: owns the per-user throttle and publishes accepted
// points to the bus (which feeds every instance's WebSocket hub).
export function createLocationRecorder({ bus, geofences }) {
  const lastAcceptedAt = new Map(); // `${sessionId}:${userId}` -> ms
  const sweep = setInterval(() => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, t] of lastAcceptedAt) if (t < cutoff) lastAcceptedAt.delete(k);
  }, 60_000);
  sweep.unref();

  async function authorize(userId, sessionId) {
    const membership = await getMembership(userId, sessionId);
    if (!membership) throw new HttpError(404, 'Session not found');
    if (membership.status !== 'active') throw new HttpError(409, 'Session has ended');
  }

  async function afterAccepted(sessionId, userId, loc) {
    const event = toEvent(sessionId, userId, loc);
    await bus.publish({ type: 'location', ...event });
    // Zone alerts are a side effect; a failure there must not lose the point.
    geofences?.evaluate(sessionId, userId, loc).catch((err) => {
      logger.error({ err, sessionId }, 'geofence evaluation failed');
    });
    return event;
  }

  return {
    // Validate, authorize, persist, and publish one live update.
    // Returns the stored event, or null when throttled.
    async record(userId, sessionId, input, { source = 'live' } = {}) {
      await authorize(userId, sessionId);
      const loc = parseLocation(input);

      const key = `${sessionId}:${userId}`;
      const now = Date.now();
      if (now - (lastAcceptedAt.get(key) || 0) < config.locationMinIntervalMs) return null;
      lastAcceptedAt.set(key, now);

      await query(
        `insert into public.location_history
           (session_id, user_id, lat, lng, accuracy, heading, speed, recorded_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sessionId, userId, loc.lat, loc.lng, loc.accuracy, loc.heading, loc.speed, loc.recordedAt],
      );
      metrics.locations.inc({ source });
      return afterAccepted(sessionId, userId, loc);
    },

    // Points collected while the device was offline. All are stored (thinned
    // to the normal rate by device time) so history and replay have no gaps;
    // only the newest is broadcast as the live position.
    async recordBatch(userId, sessionId, inputs) {
      await authorize(userId, sessionId);
      const points = thinByTime(
        inputs.map((p) => parseLocation(p)),
        config.locationMinIntervalMs,
      );
      if (points.length === 0) return { accepted: 0, latest: null };

      await query(
        `insert into public.location_history
           (session_id, user_id, lat, lng, accuracy, heading, speed, recorded_at)
         select $1, $2, * from unnest(
           $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::timestamptz[]
         )`,
        [
          sessionId,
          userId,
          points.map((p) => p.lat),
          points.map((p) => p.lng),
          points.map((p) => p.accuracy),
          points.map((p) => p.heading),
          points.map((p) => p.speed),
          points.map((p) => p.recordedAt),
        ],
      );
      metrics.locations.inc({ source: 'batch' }, points.length);
      lastAcceptedAt.set(`${sessionId}:${userId}`, Date.now());

      const latest = points[points.length - 1];
      // Don't move the marker backwards if a live point already overtook the batch.
      const { rows } = await query(
        `select max(recorded_at) as newest from public.location_history
          where session_id = $1 and user_id = $2`,
        [sessionId, userId],
      );
      const isNewest = !rows[0].newest || new Date(rows[0].newest) <= latest.recordedAt;
      return {
        accepted: points.length,
        latest: isNewest ? await afterAccepted(sessionId, userId, latest) : null,
      };
    },

    close() {
      clearInterval(sweep);
    },
  };
}

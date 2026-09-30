import { config } from '../config.js';
import { query } from '../db.js';
import { locationBus } from '../bus.js';
import { HttpError, getMembership } from './sessions.js';

const lastAcceptedAt = new Map(); // `${sessionId}:${userId}` -> ms

function finiteOrNull(value) {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? null : n;
}

export function parseLocation(input) {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'Invalid lat');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, 'Invalid lng');

  // Trust the device timestamp only within a sane window around server time.
  const now = Date.now();
  let recordedAt = input?.timestamp ? new Date(input.timestamp).getTime() : now;
  if (!Number.isFinite(recordedAt) || recordedAt > now + 60_000 || recordedAt < now - 24 * 3600_000) {
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

// Validate, authorize, persist, and publish a location update from userId.
// Returns the stored event, or null when throttled.
export async function recordLocation(userId, sessionId, input) {
  const membership = await getMembership(userId, sessionId);
  if (!membership) throw new HttpError(404, 'Session not found');
  if (membership.status !== 'active') throw new HttpError(409, 'Session has ended');

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

  const event = {
    sessionId,
    userId,
    lat: loc.lat,
    lng: loc.lng,
    accuracy: loc.accuracy,
    heading: loc.heading,
    speed: loc.speed,
    recordedAt: loc.recordedAt.toISOString(),
  };
  await locationBus.publish(event);
  return event;
}

// Circular geofences ("zones") with enter/exit alerts.
//
// Every accepted location is checked against the session's zones. Whether a
// member is inside a zone lives in geofence_presence and is flipped with a
// conditional upsert, so with several server instances exactly one of them
// sees each transition and emits the event.
import { query } from '../db.js';
import { distanceMeters } from '../lib/geo.js';
import { metrics } from '../metrics.js';
import { HttpError, assertMember } from './sessions.js';

const CACHE_MS = 30_000;

// Hysteresis: you're "inside" within the radius, but only "outside" once
// you're clearly past it, so GPS jitter at the edge doesn't spam alerts.
export function zoneState(fence, point) {
  const d = distanceMeters(fence, point);
  const buffer = Math.max(15, Math.min(point.accuracy ?? 0, 50));
  if (d <= fence.radius_m) return true;
  if (d > fence.radius_m + buffer) return false;
  return null; // in the buffer band: no change
}

export function parseGeofence(input) {
  const name = String(input?.name ?? '').trim();
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  const radiusM = Number(input?.radiusM ?? 150);
  if (!name || name.length > 60) throw new HttpError(400, 'Name must be 1-60 characters');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'Invalid lat');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, 'Invalid lng');
  if (!Number.isFinite(radiusM) || radiusM < 25 || radiusM > 5000) {
    throw new HttpError(400, 'Radius must be 25-5000 m');
  }
  return { name, lat, lng, radiusM };
}

export function createGeofenceService({ bus }) {
  const cache = new Map(); // sessionId -> {at, fences}

  // Any instance that adds or removes a zone tells the others to drop their copy.
  const unsubscribe = bus.subscribe((event) => {
    if (event.type === 'geofences_changed') cache.delete(event.sessionId);
  });

  async function list(sessionId) {
    const hit = cache.get(sessionId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.fences;
    const { rows } = await query(
      `select id, session_id, created_by, name, lat, lng, radius_m, created_at
         from public.geofences where session_id = $1 order by created_at`,
      [sessionId],
    );
    cache.set(sessionId, { at: Date.now(), fences: rows });
    return rows;
  }

  async function changed(sessionId) {
    cache.delete(sessionId);
    await bus.publish({ type: 'geofences_changed', sessionId });
  }

  return {
    list,

    async create(userId, sessionId, input) {
      await assertMember(userId, sessionId);
      const g = parseGeofence(input);
      const { rows: [{ count }] } = await query(
        'select count(*)::int as count from public.geofences where session_id = $1',
        [sessionId],
      );
      if (count >= 20) throw new HttpError(409, 'A session can have at most 20 zones');
      const { rows } = await query(
        `insert into public.geofences (session_id, created_by, name, lat, lng, radius_m)
         values ($1, $2, $3, $4, $5, $6)
         returning id, session_id, created_by, name, lat, lng, radius_m, created_at`,
        [sessionId, userId, g.name, g.lat, g.lng, g.radiusM],
      );
      await changed(sessionId);
      return rows[0];
    },

    async remove(userId, sessionId, geofenceId) {
      const membership = await assertMember(userId, sessionId);
      const { rows } = await query(
        'select created_by from public.geofences where id = $1 and session_id = $2',
        [geofenceId, sessionId],
      );
      if (!rows[0]) throw new HttpError(404, 'Zone not found');
      if (rows[0].created_by !== userId && membership.role !== 'owner') {
        throw new HttpError(403, 'Only the zone creator or the session owner can delete it');
      }
      await query('delete from public.geofences where id = $1', [geofenceId]);
      await changed(sessionId);
    },

    async events(sessionId, limit = 50) {
      const { rows } = await query(
        `select e.id, e.geofence_id, g.name, e.user_id, e.kind, e.lat, e.lng, e.occurred_at
           from public.geofence_events e
           join public.geofences g on g.id = e.geofence_id
          where e.session_id = $1
          order by e.occurred_at desc
          limit $2`,
        [sessionId, Math.min(Number(limit) || 50, 200)],
      );
      return rows;
    },

    // Check one accepted point against the session's zones; publish transitions.
    async evaluate(sessionId, userId, point) {
      const fences = await list(sessionId);
      for (const fence of fences) {
        const inside = zoneState(fence, point);
        if (inside == null) continue;
        const { rows } = await query(
          `insert into public.geofence_presence (geofence_id, user_id, inside, changed_at)
           values ($1, $2, $3, now())
           on conflict (geofence_id, user_id) do update
             set inside = excluded.inside, changed_at = now()
             where geofence_presence.inside <> excluded.inside
           returning (xmax = 0) as inserted`,
          [fence.id, userId, inside],
        );
        if (rows.length === 0) continue; // no change
        // First sighting outside a zone isn't an event; first sighting inside is.
        if (rows[0].inserted && !inside) continue;

        const kind = inside ? 'enter' : 'exit';
        const { rows: [ev] } = await query(
          `insert into public.geofence_events (geofence_id, session_id, user_id, kind, lat, lng)
           values ($1, $2, $3, $4, $5, $6)
           returning id, occurred_at`,
          [fence.id, sessionId, userId, kind, point.lat, point.lng],
        );
        metrics.geofenceEvents.inc({ kind });
        await bus.publish({
          type: 'geofence',
          sessionId,
          id: ev.id,
          geofenceId: fence.id,
          name: fence.name,
          userId,
          kind,
          occurredAt: ev.occurred_at,
        });
      }
    },

    close: unsubscribe,
  };
}

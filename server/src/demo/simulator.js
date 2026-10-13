// Demo mode: simulated riders moving along real Bengaluru roads.
//
// Two kinds of demo session:
//  - Guest demo: a signed-in (or anonymous) user starts their own session with
//    the bots as members. It ends itself after DEMO_SESSION_MINUTES.
//  - Public demo: one shared session anyone can watch through a short-lived
//    view-only link, no sign-in. Bots only move while someone has watched it
//    in the last DEMO_IDLE_MINUTES, so an idle server isn't writing rows.
//
// Bot positions are a pure function of wall-clock time, so every instance
// agrees where a bot is. Each instance keeps a timer per demo session, but
// only the holder of the session's lease (see bus.lease) records points; if
// that instance dies, another takes the lease and the bots carry on smoothly.
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { logger } from '../logger.js';
import { bearingDegrees, distanceMeters } from '../lib/geo.js';
import { HttpError, markEnded } from '../services/sessions.js';
import { issueShareLink } from '../services/shares.js';

const data = JSON.parse(readFileSync(new URL('./routes.json', import.meta.url), 'utf8'));

export const PUBLIC_DEMO_ID = '00000000-0000-4000-8000-0000000de000';
export const DEMO_HOST_ID = '00000000-0000-4000-8000-00000000b000';
export const BOT_IDS = data.routes.map((r) => r.botId);

const log = logger.child({ component: 'demo' });

// Precompute cumulative distance along each closed loop.
export const ROUTES = data.routes.map((r) => {
  const path = r.path.map(([lat, lng]) => ({ lat, lng }));
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distanceMeters(path[i - 1], path[i]));
  return { ...r, path, cum, length: cum[cum.length - 1] };
});

// Where a bot is after travelling `meters` around its loop (wraps around).
export function positionAlong(route, meters) {
  const { path, cum, length } = route;
  const d = ((meters % length) + length) % length;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const seg = cum[hi] - cum[lo];
  const t = seg > 0 ? (d - cum[lo]) / seg : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    heading: bearingDegrees(a, b),
  };
}

export function botPosition(route, index, nowMs) {
  // Spread bots out so they don't all start together.
  const offset = (index * route.length) / 3;
  const pos = positionAlong(route, (nowMs / 1000) * route.speedMps + offset);
  return { ...pos, speed: route.speedMps, accuracy: 8, timestamp: nowMs };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

async function seedMembersAndZones(client, sessionId, createdBy) {
  await client.query(
    `insert into public.tracking_session_members (session_id, user_id, role)
     select $1, unnest($2::uuid[]), 'member'
     on conflict do nothing`,
    [sessionId, BOT_IDS],
  );
  for (const z of data.zones) {
    await client.query(
      `insert into public.geofences (session_id, created_by, name, lat, lng, radius_m)
       values ($1, $2, $3, $4, $5, $6)`,
      [sessionId, createdBy, z.name, z.lat, z.lng, z.radiusM],
    );
  }
}

export function createDemoService({ bus, recorder }) {
  const timers = new Map(); // sessionId -> interval
  const state = new Map(); // sessionId -> {checkedAt, session}
  let rescan = null;

  async function sessionState(sessionId) {
    const hit = state.get(sessionId);
    if (hit && Date.now() - hit.checkedAt < 5000) return hit.session;
    const { rows } = await query(
      `select id, status, expires_at, demo_active_until from public.tracking_sessions
        where id = $1 and is_demo`,
      [sessionId],
    );
    state.set(sessionId, { checkedAt: Date.now(), session: rows[0] || null });
    return rows[0] || null;
  }

  async function tick(sessionId) {
    const session = await sessionState(sessionId);
    if (!session || session.status !== 'active') return stop(sessionId);

    const leaseMs = config.demo.tickMs * 3;
    if (!(await bus.lease(`demo:${sessionId}`, leaseMs))) return; // another instance drives it

    const now = Date.now();
    if (session.expires_at && new Date(session.expires_at).getTime() <= now) {
      await markEnded(sessionId);
      await bus.publish({ type: 'session_ended', sessionId });
      log.info({ sessionId }, 'demo session expired');
      return stop(sessionId);
    }
    if (session.demo_active_until && new Date(session.demo_active_until).getTime() < now) return; // nobody watching

    await Promise.all(
      ROUTES.map((route, i) =>
        recorder.record(route.botId, sessionId, botPosition(route, i, now), { source: 'demo' }),
      ),
    );
  }

  function start(sessionId) {
    if (timers.has(sessionId)) return;
    const timer = setInterval(() => {
      tick(sessionId).catch((err) => log.error({ err, sessionId }, 'demo tick failed'));
    }, config.demo.tickMs);
    timer.unref();
    timers.set(sessionId, timer);
  }

  function stop(sessionId) {
    clearInterval(timers.get(sessionId));
    timers.delete(sessionId);
    state.delete(sessionId);
  }

  // Pick up demo sessions created on other instances (or before a restart).
  async function scan() {
    const { rows } = await query(
      `select id from public.tracking_sessions where is_demo and status = 'active'`,
    );
    for (const r of rows) start(r.id);
  }

  async function ensurePublicDemo() {
    await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `insert into public.tracking_sessions (id, owner_id, name, join_code, is_demo, status)
         values ($1, $2, 'Live demo · Bengaluru', $3, true, 'active')
         on conflict (id) do nothing`,
        [PUBLIC_DEMO_ID, DEMO_HOST_ID, joinCode()],
      );
      if (rowCount === 0) return;
      await client.query(
        `insert into public.tracking_session_members (session_id, user_id, role) values ($1, $2, 'owner')`,
        [PUBLIC_DEMO_ID, DEMO_HOST_ID],
      );
      await seedMembersAndZones(client, PUBLIC_DEMO_ID, DEMO_HOST_ID);
    });
    // The public demo never ends; revive it if someone ended it by hand.
    await query(
      `update public.tracking_sessions set status = 'active', ended_at = null where id = $1 and status <> 'active'`,
      [PUBLIC_DEMO_ID],
    );
    start(PUBLIC_DEMO_ID);
  }

  return {
    async boot() {
      if (!config.demo.enabled) return;
      await scan();
      rescan = setInterval(() => scan().catch((err) => log.error({ err }, 'demo scan failed')), 30_000);
      rescan.unref();
    },

    // Keeps the public demo moving while someone is watching.
    async touch(sessionId) {
      await query(
        `update public.tracking_sessions
            set demo_active_until = now() + make_interval(mins => $2)
          where id = $1 and is_demo and demo_active_until is not null`,
        [sessionId, config.demo.idleMinutes],
      );
      state.delete(sessionId);
    },

    // A short-lived view-only link to the public demo. No sign-in needed.
    async publicViewLink() {
      if (!config.demo.enabled) throw new HttpError(404, 'Demo is disabled');
      await ensurePublicDemo();
      await query(
        `update public.tracking_sessions
            set demo_active_until = now() + make_interval(mins => $2)
          where id = $1`,
        [PUBLIC_DEMO_ID, config.demo.idleMinutes],
      );
      state.delete(PUBLIC_DEMO_ID);
      return issueShareLink(DEMO_HOST_ID, PUBLIC_DEMO_ID, config.demo.viewTokenMinutes);
    },

    // A private demo session for this user, with bots and zones. Reuses an
    // active one if the user already has it.
    async createGuestDemo(userId) {
      if (!config.demo.enabled) throw new HttpError(404, 'Demo is disabled');
      const { rows: existing } = await query(
        `select id from public.tracking_sessions
          where owner_id = $1 and is_demo and status = 'active' and expires_at > now()
          limit 1`,
        [userId],
      );
      if (existing[0]) return { id: existing[0].id, reused: true };

      const id = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `insert into public.tracking_sessions (owner_id, name, join_code, is_demo, expires_at)
           values ($1, 'Demo ride · Bengaluru', $2, true, now() + make_interval(mins => $3))
           returning id`,
          [userId, joinCode(), config.demo.sessionMinutes],
        );
        const sessionId = rows[0].id;
        await client.query(
          `insert into public.tracking_session_members (session_id, user_id, role) values ($1, $2, 'owner')`,
          [sessionId, userId],
        );
        await seedMembersAndZones(client, sessionId, userId);
        return sessionId;
      });
      start(id);
      return { id, reused: false };
    },

    isDemoSession: (sessionId) => timers.has(sessionId),
    // For tests: run a tick now, forgetting cached session state first.
    async tick(sessionId) {
      state.delete(sessionId);
      return tick(sessionId);
    },

    close() {
      clearInterval(rescan);
      for (const id of [...timers.keys()]) stop(id);
    },
  };
}

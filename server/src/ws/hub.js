// WebSocket hub: authenticates connections, keeps per-session rooms, and fans
// bus events out to the sockets in each room. See ./protocol.js for messages.
//
// Rooms are per instance. Events reach every instance through the bus, so a
// member connected to instance A sees points sent to instance B.
//
// Tokens are sent as the first message rather than in the URL so they never
// land in proxy or access logs.
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { verifyAccessToken } from '../auth.js';
import { logger } from '../logger.js';
import { metrics, trackSockets } from '../metrics.js';
import { TokenBucket } from '../rateLimit.js';
import { getMembership, latestLocations } from '../services/sessions.js';
import { resolveShareToken } from '../services/shares.js';
import { parseClientMessage } from './protocol.js';

const MAX_MESSAGE_BYTES = 64 * 1024; // room for a 500-point offline batch
const MAX_RATE_STRIKES = 50;
const log = logger.child({ component: 'ws' });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function errorCode(err) {
  if (err.status === 404) return 'not_found';
  if (err.status === 409) return 'session_ended';
  if (err.status === 400) return 'bad_request';
  return 'internal';
}

export function createHub({ server, bus, recorder, demo }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  const rooms = new Map(); // sessionId -> Set<ws>

  function joinRoom(ws, sessionId) {
    if (!rooms.has(sessionId)) rooms.set(sessionId, new Set());
    rooms.get(sessionId).add(ws);
    ws.ctx.sessions.add(sessionId);
  }

  function leaveRoom(ws, sessionId) {
    const room = rooms.get(sessionId);
    room?.delete(ws);
    if (room?.size === 0) rooms.delete(sessionId);
    ws.ctx.sessions.delete(sessionId);
  }

  function broadcast(sessionId, msg) {
    const room = rooms.get(sessionId);
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const ws of room) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  // Events from any instance (or this one) -> local sockets.
  const unsubscribe = bus.subscribe((event) => {
    const { sessionId } = event;
    switch (event.type) {
      case 'location':
      case 'geofence':
      case 'geofences_changed':
      case 'session_ended':
        broadcast(sessionId, event);
        break;
      case 'evict':
        for (const ws of [...(rooms.get(sessionId) || [])]) {
          if (ws.ctx.user?.id === event.userId) {
            leaveRoom(ws, sessionId);
            send(ws, { type: 'removed', sessionId });
          }
        }
        break;
      case 'share_revoked':
        for (const ws of [...(rooms.get(sessionId) || [])]) {
          if (ws.ctx.share?.shareId === event.shareId) {
            send(ws, { type: 'share_revoked' });
            ws.close(4403, 'Share link revoked');
          }
        }
        break;
    }
  });

  async function sendJoined(ws, sessionId, status) {
    send(ws, { type: 'joined', sessionId, status, latest: await latestLocations(sessionId) });
  }

  function tokenExpired(ws) {
    const exp = ws.ctx.user?.expiresAt;
    return exp != null && Date.now() >= exp;
  }

  async function handleAuth(ws, msg) {
    const { ctx } = ws;
    if (ctx.share) {
      send(ws, { type: 'error', code: 'forbidden', message: 'This connection is view-only' });
      return;
    }
    try {
      const user = await verifyAccessToken(msg.token);
      // A connection belongs to one identity for its lifetime.
      if (ctx.user && ctx.user.id !== user.id) {
        send(ws, { type: 'error', code: 'unauthorized', message: 'Token belongs to a different user' });
        ws.close(4401, 'Unauthorized');
        return;
      }
      ctx.user = user;
      clearTimeout(ctx.authTimer);
      send(ws, { type: 'auth_ok', userId: user.id, expiresAt: user.expiresAt });
    } catch {
      send(ws, { type: 'error', code: 'unauthorized', message: 'Invalid or expired token' });
      if (!ctx.user) ws.close(4401, 'Unauthorized');
    }
  }

  // View-only access through a share link: joins exactly one room, can't send.
  async function handleShareAuth(ws, msg) {
    const { ctx } = ws;
    if (ctx.user || ctx.share) {
      send(ws, { type: 'error', code: 'bad_request', message: 'Already authenticated' });
      return;
    }
    const share = await resolveShareToken(msg.token);
    if (!share) {
      send(ws, { type: 'error', code: 'unauthorized', message: 'Link is invalid or has expired' });
      ws.close(4401, 'Unauthorized');
      return;
    }
    ctx.share = share;
    clearTimeout(ctx.authTimer);
    ctx.shareTimer = setTimeout(() => {
      send(ws, { type: 'share_expired' });
      ws.close(4403, 'Share link expired');
    }, Math.max(0, share.expiresAt - Date.now()));
    joinRoom(ws, share.sessionId);
    send(ws, { type: 'auth_share_ok', sessionId: share.sessionId, expiresAt: share.expiresAt });
    await sendJoined(ws, share.sessionId, 'active');
    demo?.touch(share.sessionId).catch(() => {});
  }

  async function handleMessage(ws, msg) {
    const { ctx } = ws;
    if (msg.type === 'auth') return handleAuth(ws, msg);
    if (msg.type === 'auth_share') return handleShareAuth(ws, msg);
    if (msg.type === 'ping') return send(ws, { type: 'pong' });

    if (ctx.share) {
      send(ws, { type: 'error', code: 'forbidden', message: 'This connection is view-only' });
      return;
    }
    if (!ctx.user) {
      send(ws, { type: 'error', code: 'unauthorized', message: 'Authenticate first' });
      return;
    }
    if (tokenExpired(ws)) {
      send(ws, { type: 'auth_expired' });
      return;
    }

    const { sessionId } = msg;
    switch (msg.type) {
      case 'join': {
        if (!ctx.sessions.has(sessionId) && ctx.sessions.size >= config.ws.maxSessionsPerSocket) {
          send(ws, { type: 'error', code: 'bad_request', message: 'Too many sessions on one connection', sessionId });
          return;
        }
        const membership = await getMembership(ctx.user.id, sessionId);
        if (!membership) {
          send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
          return;
        }
        joinRoom(ws, sessionId);
        await sendJoined(ws, sessionId, membership.status);
        return;
      }

      case 'leave':
        leaveRoom(ws, sessionId);
        send(ws, { type: 'left', sessionId });
        return;

      // record/recordBatch re-check membership against the database, so a
      // user removed via REST can't keep writing through an old socket.
      case 'location':
        try {
          await recorder.record(ctx.user.id, sessionId, msg);
        } catch (err) {
          send(ws, { type: 'error', code: errorCode(err), message: err.status ? err.message : 'Could not save location', sessionId });
          if (!err.status) log.error({ err, sessionId }, 'location error');
        }
        return;

      case 'location_batch':
        try {
          const { accepted } = await recorder.recordBatch(ctx.user.id, sessionId, msg.points);
          send(ws, { type: 'batch_ack', sessionId, ref: msg.ref, accepted });
        } catch (err) {
          send(ws, { type: 'error', code: errorCode(err), message: err.status ? err.message : 'Could not save locations', sessionId, ref: msg.ref });
          if (!err.status) log.error({ err, sessionId }, 'batch error');
        }
        return;
    }
  }

  function onRateLimited(ws) {
    const { ctx } = ws;
    metrics.rateLimited.inc({ kind: 'ws' });
    ctx.strikes += 1;
    if (ctx.strikes > MAX_RATE_STRIKES) {
      ws.close(1008, 'Rate limit exceeded');
      return;
    }
    // Tell the client, but at most once a second.
    const now = Date.now();
    if (now - ctx.lastRateNotice > 1000) {
      ctx.lastRateNotice = now;
      send(ws, { type: 'error', code: 'rate_limited', message: 'Slow down' });
    }
  }

  wss.on('connection', (ws) => {
    ws.ctx = {
      user: null,
      share: null,
      sessions: new Set(),
      alive: true,
      queue: Promise.resolve(),
      bucket: new TokenBucket(config.ws.ratePerSec, config.ws.rateBurst),
      strikes: 0,
      lastRateNotice: 0,
    };
    ws.ctx.authTimer = setTimeout(() => {
      if (!ws.ctx.user && !ws.ctx.share) ws.close(4401, 'Authentication timeout');
    }, config.ws.authTimeoutMs);

    ws.on('pong', () => (ws.ctx.alive = true));

    ws.on('message', (data) => {
      if (!ws.ctx.bucket.take()) return onRateLimited(ws);

      let raw;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return send(ws, { type: 'error', code: 'bad_request', message: 'Invalid JSON' });
      }
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        return send(ws, { type: 'error', code: 'bad_request', message: parsed.message, ref: raw?.ref });
      }
      metrics.wsMessages.inc({ type: parsed.msg.type });
      // Process messages in order per connection (auth before join, etc).
      ws.ctx.queue = ws.ctx.queue
        .then(() => handleMessage(ws, parsed.msg))
        .catch((err) => {
          log.error({ err }, 'handler error');
          send(ws, { type: 'error', code: 'internal', message: 'Internal error' });
        });
    });

    ws.on('close', () => {
      clearTimeout(ws.ctx.authTimer);
      clearTimeout(ws.ctx.shareTimer);
      for (const sessionId of [...ws.ctx.sessions]) leaveRoom(ws, sessionId);
    });
  });

  const heartbeat = setInterval(() => {
    const watched = new Set();
    for (const ws of wss.clients) {
      if (!ws.ctx.alive) {
        ws.terminate();
        continue;
      }
      ws.ctx.alive = false;
      ws.ping();
      if (ws.ctx.share) watched.add(ws.ctx.share.sessionId);
    }
    // Keep the public demo moving while someone watches it.
    for (const id of watched) demo?.touch(id).catch(() => {});
  }, config.ws.heartbeatMs);

  const untrack = trackSockets(() => {
    let users = 0;
    let viewers = 0;
    for (const ws of wss.clients) {
      if (ws.ctx?.share) viewers += 1;
      else users += 1;
    }
    return { users, viewers };
  });

  return {
    wss,
    roomSize: (sessionId) => rooms.get(sessionId)?.size || 0,
    async close() {
      clearInterval(heartbeat);
      untrack();
      unsubscribe();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

// WebSocket server.
//
// Protocol (JSON messages):
//   client -> {type:'auth', token}            first message, within AUTH_TIMEOUT_MS;
//                                             resend whenever the client refreshes its token
//   server -> {type:'auth_ok', userId, expiresAt} | {type:'error', code:'unauthorized'}
//   client -> {type:'join', sessionId}
//   server -> {type:'joined', sessionId, latest:[...]}
//   client -> {type:'location', sessionId, lat, lng, accuracy?, heading?, speed?, timestamp?}
//   server -> {type:'location', sessionId, userId, lat, lng, ...}    to everyone in the session
//   client -> {type:'leave', sessionId}
//   server -> {type:'session_ended', sessionId} | {type:'removed', sessionId}
//   server -> {type:'auth_expired'}           token expired; send a fresh {type:'auth'}
//
// The token is sent as a message rather than in the URL so it never lands in
// proxy or access logs.
import { WebSocketServer } from 'ws';
import { verifyAccessToken } from '../auth.js';
import { locationBus } from '../bus.js';
import { getMembership, latestLocations } from '../services/sessions.js';
import { recordLocation } from '../services/locations.js';

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_BYTES = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rooms = new Map(); // sessionId -> Set<ws>

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

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

// Called by the REST layer when membership changes.
export function notifySessionEnded(sessionId) {
  broadcast(sessionId, { type: 'session_ended', sessionId });
}

export function evictFromSession(sessionId, userId) {
  const room = rooms.get(sessionId);
  if (!room) return;
  for (const ws of [...room]) {
    if (ws.ctx.user?.id === userId) {
      leaveRoom(ws, sessionId);
      send(ws, { type: 'removed', sessionId });
    }
  }
}

function tokenExpired(ws) {
  const exp = ws.ctx.user?.expiresAt;
  return exp != null && Date.now() >= exp;
}

async function handleMessage(ws, msg) {
  const { ctx } = ws;

  if (msg.type === 'auth') {
    try {
      const user = await verifyAccessToken(msg.token);
      // A connection belongs to one identity for its lifetime.
      if (ctx.user && ctx.user.id !== user.id) {
        send(ws, { type: 'error', code: 'unauthorized', message: 'Token belongs to a different user' });
        return ws.close(4401, 'Unauthorized');
      }
      ctx.user = user;
      clearTimeout(ctx.authTimer);
      send(ws, { type: 'auth_ok', userId: user.id, expiresAt: user.expiresAt });
    } catch {
      send(ws, { type: 'error', code: 'unauthorized', message: 'Invalid or expired token' });
      if (!ctx.user) ws.close(4401, 'Unauthorized');
    }
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

  const sessionId = msg.sessionId;
  if (['join', 'leave', 'location'].includes(msg.type) && !UUID_RE.test(sessionId || '')) {
    send(ws, { type: 'error', code: 'bad_request', message: 'Invalid sessionId', ref: msg.ref });
    return;
  }

  switch (msg.type) {
    case 'join': {
      const membership = await getMembership(ctx.user.id, sessionId);
      if (!membership) {
        send(ws, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
        return;
      }
      joinRoom(ws, sessionId);
      send(ws, {
        type: 'joined',
        sessionId,
        status: membership.status,
        latest: await latestLocations(sessionId),
      });
      return;
    }

    case 'leave':
      leaveRoom(ws, sessionId);
      send(ws, { type: 'left', sessionId });
      return;

    case 'location': {
      // recordLocation re-checks membership against the database, so a user
      // removed via REST can't keep writing through an old socket.
      try {
        await recordLocation(ctx.user.id, sessionId, msg);
      } catch (err) {
        send(ws, {
          type: 'error',
          code: err.status === 404 ? 'not_found' : err.status === 409 ? 'session_ended' : 'bad_request',
          message: err.status ? err.message : 'Could not save location',
          sessionId,
        });
        if (!err.status) console.error('[ws] location error', err);
      }
      return;
    }

    case 'ping':
      send(ws, { type: 'pong' });
      return;

    default:
      send(ws, { type: 'error', code: 'bad_request', message: `Unknown type ${msg.type}` });
  }
}

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

  // Fan accepted locations out to everyone in the session. With Kafka, this
  // subscription becomes a consumer-group handler.
  locationBus.subscribe((event) => broadcast(event.sessionId, { type: 'location', ...event }));

  wss.on('connection', (ws) => {
    ws.ctx = { user: null, sessions: new Set(), alive: true, queue: Promise.resolve() };
    ws.ctx.authTimer = setTimeout(() => {
      if (!ws.ctx.user) ws.close(4401, 'Authentication timeout');
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => (ws.ctx.alive = true));

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return send(ws, { type: 'error', code: 'bad_request', message: 'Invalid JSON' });
      }
      if (!msg || typeof msg.type !== 'string') {
        return send(ws, { type: 'error', code: 'bad_request', message: 'Missing type' });
      }
      // Process messages in order per connection (auth before join, etc).
      ws.ctx.queue = ws.ctx.queue
        .then(() => handleMessage(ws, msg))
        .catch((err) => {
          console.error('[ws] handler error', err);
          send(ws, { type: 'error', code: 'internal', message: 'Internal error' });
        });
    });

    ws.on('close', () => {
      clearTimeout(ws.ctx.authTimer);
      for (const sessionId of [...ws.ctx.sessions]) leaveRoom(ws, sessionId);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.ctx.alive) {
        ws.terminate();
        continue;
      }
      ws.ctx.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

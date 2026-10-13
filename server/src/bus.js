// Event bus between the parts of the server that produce events (REST
// handlers, location recording, the demo simulator) and the WebSocket hub that
// fans them out to clients.
//
// Without REDIS_URL the bus is an in-process EventEmitter: fine for one
// instance. With REDIS_URL every instance publishes to one Redis channel and
// every instance's hub receives every event, so a client connected to instance
// A sees locations sent to instance B. Producers and the hub don't know which
// one they're talking to.
//
// Events are plain JSON: {type, sessionId, ...}. Types:
//   location        an accepted location update
//   session_ended   owner ended the session
//   evict           {userId} left / was removed
//   share_revoked   {shareId} a view-only link was revoked
//   geofence        {geofenceId, userId, kind:'enter'|'exit', ...}
//   geofences_changed  a zone was added or removed
//
// The bus also hands out leases (a Redis key with a TTL), used so only one
// instance simulates a given demo session.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { logger } from './logger.js';

const CHANNEL = 'llt:events';

// Take the lease if free, renew it if we hold it. Atomic in Redis.
const LEASE_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
if v == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0`;

function createLocalBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const leases = new Map(); // key -> {owner, until}
  return {
    kind: 'memory',
    instanceId: randomUUID(),
    async publish(event) {
      emitter.emit('event', event);
    },
    subscribe(handler) {
      emitter.on('event', handler);
      return () => emitter.off('event', handler);
    },
    async lease(key, ttlMs) {
      const now = Date.now();
      const held = leases.get(key);
      if (held && held.owner !== this.instanceId && held.until > now) return false;
      leases.set(key, { owner: this.instanceId, until: now + ttlMs });
      return true;
    },
    async ready() {},
    async ping() {
      return true;
    },
    async close() {
      emitter.removeAllListeners();
    },
  };
}

function createRedisBus(url) {
  const opts = { maxRetriesPerRequest: 3, lazyConnect: true };
  const pub = new Redis(url, opts);
  const sub = new Redis(url, opts);
  const handlers = new Set();
  const log = logger.child({ component: 'bus' });

  pub.on('error', (err) => log.warn({ err: err.message }, 'redis publisher error'));
  sub.on('error', (err) => log.warn({ err: err.message }, 'redis subscriber error'));
  sub.on('message', (channel, raw) => {
    if (channel !== CHANNEL) return;
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    for (const h of handlers) {
      try {
        h(event);
      } catch (err) {
        log.error({ err }, 'bus handler failed');
      }
    }
  });
  pub.defineCommand('lease', { numberOfKeys: 1, lua: LEASE_SCRIPT });

  return {
    kind: 'redis',
    instanceId: randomUUID(),
    // Our own published events come back through the subscription, so the
    // local hub is fed exactly like every other instance's.
    async publish(event) {
      await pub.publish(CHANNEL, JSON.stringify(event));
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async lease(key, ttlMs) {
      return (await pub.lease(`llt:lease:${key}`, this.instanceId, ttlMs)) === 1;
    },
    async ready() {
      await Promise.all([pub.connect(), sub.connect()]);
      await sub.subscribe(CHANNEL);
    },
    async ping() {
      return (await pub.ping()) === 'PONG';
    },
    async close() {
      handlers.clear();
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}

export function createBus({ redisUrl } = {}) {
  return redisUrl ? createRedisBus(redisUrl) : createLocalBus();
}

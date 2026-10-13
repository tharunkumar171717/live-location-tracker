// Token-bucket rate limiting. A bucket holds up to `burst` tokens and refills
// at `ratePerSec`; each action takes one. Short bursts pass, sustained floods
// don't.
//
// Limits are per instance (in memory). With several instances behind a load
// balancer a client can get up to N x the limit, which is acceptable for
// abuse protection; a shared Redis limiter would be the next step.
import { metrics } from './metrics.js';

export class TokenBucket {
  constructor(ratePerSec, burst) {
    this.ratePerSec = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.updatedAt = Date.now();
  }

  take(now = Date.now()) {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  // Seconds until one token is available.
  retryAfter() {
    return Math.max(0, (1 - this.tokens) / this.ratePerSec);
  }
}

// One bucket per key (user id, IP). Idle buckets are swept so the map can't grow forever.
export function createKeyedLimiter({ ratePerMin, burst = ratePerMin, idleMs = 10 * 60_000 }) {
  const buckets = new Map();
  const sweep = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [key, b] of buckets) if (b.updatedAt < cutoff) buckets.delete(key);
  }, idleMs);
  sweep.unref();

  return {
    take(key) {
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = new TokenBucket(ratePerMin / 60, burst)));
      return { ok: b.take(), retryAfter: b.retryAfter() };
    },
    close() {
      clearInterval(sweep);
    },
  };
}

// Express middleware. keyFn(req) picks the bucket (user id or IP).
export function httpRateLimit({ ratePerMin, keyFn, name }) {
  const limiter = createKeyedLimiter({ ratePerMin });
  const mw = (req, res, next) => {
    const { ok, retryAfter } = limiter.take(keyFn(req));
    if (ok) return next();
    metrics.rateLimited.inc({ kind: name });
    res.set('Retry-After', String(Math.ceil(retryAfter) || 1));
    res.status(429).json({ error: 'Too many requests' });
  };
  mw.close = () => limiter.close();
  return mw;
}

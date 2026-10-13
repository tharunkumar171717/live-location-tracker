import { describe, expect, it, vi } from 'vitest';
import { TokenBucket, httpRateLimit } from '../src/rateLimit.js';
import { parseClientMessage } from '../src/ws/protocol.js';
import { parseLocation, thinByTime } from '../src/services/locations.js';

describe('TokenBucket', () => {
  it('allows a burst, then refills at the rate', () => {
    const b = new TokenBucket(2, 3);
    const t = 1_000_000;
    expect([b.take(t), b.take(t), b.take(t), b.take(t)]).toEqual([true, true, true, false]);
    expect(b.take(t + 499)).toBe(false);
    expect(b.take(t + 500)).toBe(true);
  });
});

describe('httpRateLimit', () => {
  it('answers 429 with Retry-After once the bucket is empty', () => {
    const mw = httpRateLimit({ name: 'test', ratePerMin: 2, keyFn: () => 'k' });
    const next = vi.fn();
    const res = { set: vi.fn(), status: vi.fn(() => res), json: vi.fn() };
    mw({}, res, next);
    mw({}, res, next);
    mw({}, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    mw.close();
  });
});

describe('protocol', () => {
  it('accepts valid messages and strips unknown fields', () => {
    const r = parseClientMessage({
      type: 'location',
      sessionId: '00000000-0000-4000-8000-000000000001',
      lat: 1,
      lng: 2,
      userId: 'spoofed',
    });
    expect(r.ok).toBe(true);
    expect(r.msg).not.toHaveProperty('userId');
  });

  it('explains what is wrong', () => {
    expect(parseClientMessage({ type: 'auth' }).message).toMatch(/^token:/);
    expect(parseClientMessage({ type: 'location', sessionId: 'x', lat: 1, lng: 1 }).ok).toBe(false);
    expect(parseClientMessage(null).ok).toBe(false);
  });
});

describe('locations', () => {
  it('ignores device timestamps outside a sane window', () => {
    const now = 1_700_000_000_000;
    expect(parseLocation({ lat: 1, lng: 1, timestamp: now + 3_600_000 }, now).recordedAt.getTime()).toBe(now);
    expect(parseLocation({ lat: 1, lng: 1, timestamp: now - 1000 }, now).recordedAt.getTime()).toBe(now - 1000);
  });

  it('drops nonsense accuracy, heading and speed', () => {
    const p = parseLocation({ lat: 1, lng: 1, accuracy: -5, heading: 400, speed: -1 });
    expect(p).toMatchObject({ accuracy: null, heading: null, speed: null });
  });

  it('thins points to the minimum gap by device time', () => {
    const pts = [0, 300, 1000, 1200, 2500].map((t) => ({ recordedAt: new Date(t) }));
    expect(thinByTime(pts, 1000).map((p) => p.recordedAt.getTime())).toEqual([0, 1000, 2500]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSendPolicy } from '../../src/tracking/sendPolicy.js';
import { BATCH_SIZE, MAX_POINTS, Outbox } from '../../src/tracking/outbox.js';
import { TrackingSocket } from '../../src/tracking/TrackingSocket.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const at = (metersNorth) => ({ lat: 12.97 + metersNorth / 111_195, lng: 77.59 });

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

describe('send policy', () => {
  it('sends every ~1.5 s while moving', () => {
    const p = createSendPolicy();
    const sends = [];
    for (let t = 0; t <= 6000; t += 500) sends.push(p.check({ ...at(t / 100), speed: 5 }, { now: t }).send);
    // t = 0, 1500, 3000, 4500, 6000
    expect(sends.filter(Boolean)).toHaveLength(5);
  });

  it('goes idle when standing still and only heartbeats', () => {
    const p = createSendPolicy();
    let sent = 0;
    let mode;
    for (let t = 0; t <= 60_000; t += 1000) {
      const r = p.check({ ...at(Math.sin(t) * 2), speed: 0 }, { now: t }); // 2 m GPS jitter
      if (r.send) sent += 1;
      mode = r.mode;
    }
    expect(mode).toBe('idle');
    // ~1.5 s cadence for the first 20 s, then a 15 s heartbeat.
    expect(sent).toBeLessThan(20);
  });

  it('wakes up as soon as you really move', () => {
    const p = createSendPolicy();
    for (let t = 0; t <= 30_000; t += 1000) p.check({ ...at(0), speed: 0 }, { now: t });
    expect(p.check({ ...at(0), speed: 0 }, { now: 31_000 }).send).toBe(false);
    const r = p.check({ ...at(20), speed: 0 }, { now: 32_000 });
    expect(r).toEqual({ send: true, mode: 'moving' });
  });

  it('backs off while the tab is hidden', () => {
    const p = createSendPolicy();
    p.check({ ...at(0), speed: 5 }, { now: 0 });
    expect(p.check({ ...at(10), speed: 5 }, { now: 2000, hidden: true }).send).toBe(false);
    expect(p.check({ ...at(60), speed: 5 }, { now: 10_000, hidden: true }).send).toBe(true);
  });
});

describe('outbox', () => {
  it('persists, batches, and only drops points once acked', () => {
    const storage = memoryStorage();
    const box = new Outbox(SESSION, storage);
    for (let i = 0; i < BATCH_SIZE + 5; i++) box.push({ lat: i, lng: 0 });
    expect(new Outbox(SESSION, storage).size).toBe(BATCH_SIZE + 5); // survives reload

    const first = box.nextBatch();
    expect(first.points).toHaveLength(BATCH_SIZE);
    expect(box.nextBatch()).toBeNull(); // one in flight at a time
    box.unsend(); // connection dropped
    const again = box.nextBatch();
    expect(again.points[0].lat).toBe(0);
    expect(box.ack('wrong-ref')).toBe(false);
    expect(box.ack(again.ref)).toBe(true);
    expect(box.size).toBe(5);
    expect(box.ack(box.nextBatch().ref)).toBe(true);
    expect(storage.map.size).toBe(0);
  });

  it('caps its size, dropping the oldest points', () => {
    const box = new Outbox(SESSION, memoryStorage());
    for (let i = 0; i < MAX_POINTS + 10; i++) box.push({ lat: i, lng: 0 });
    expect(box.size).toBe(MAX_POINTS);
    expect(box.points[0].lat).toBe(10);
  });
});

// Minimal stand-in for the browser WebSocket.
class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

describe('TrackingSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function connected(opts = {}) {
    const statuses = [];
    const outbox = [];
    const sock = new TrackingSocket({
      url: 'ws://test/ws',
      getToken: async () => 'token-1',
      onStatus: (s) => statuses.push(s),
      onOutbox: (id, n) => outbox.push(n),
      storage: memoryStorage(),
      ...opts,
    });
    sock.join(SESSION);
    sock.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    ws.receive({ type: 'auth_ok', userId: 'u1' });
    return { sock, ws, statuses, outbox };
  }

  it('authenticates first, then joins', async () => {
    const { ws, statuses } = await connected();
    expect(ws.sent.map((m) => m.type)).toEqual(['auth', 'join']);
    expect(statuses.at(-1)).toBe('connected');
  });

  it('buffers points while offline and sends them as one acked batch', async () => {
    const { sock, ws, outbox } = await connected();
    ws.drop();
    for (let i = 0; i < 3; i++) sock.sendLocation(SESSION, { lat: 1 + i, lng: 2, timestamp: i });
    expect(outbox.at(-1)).toBe(3);

    await vi.advanceTimersByTimeAsync(1000);
    const ws2 = FakeWebSocket.instances.at(-1);
    expect(ws2).not.toBe(ws);
    ws2.open();
    ws2.receive({ type: 'auth_ok' });
    const batch = ws2.sent.find((m) => m.type === 'location_batch');
    expect(batch.points.map((p) => p.lat)).toEqual([1, 2, 3]);

    // Live points wait behind the unacked batch to keep order.
    sock.sendLocation(SESSION, { lat: 9, lng: 9 });
    expect(ws2.sent.filter((m) => m.type === 'location')).toHaveLength(0);

    ws2.receive({ type: 'batch_ack', sessionId: SESSION, ref: batch.ref, accepted: 3 });
    const second = ws2.sent.filter((m) => m.type === 'location_batch')[1];
    expect(second.points.map((p) => p.lat)).toEqual([9]);
    ws2.receive({ type: 'batch_ack', sessionId: SESSION, ref: second.ref, accepted: 1 });
    expect(outbox.at(-1)).toBe(0);

    sock.sendLocation(SESSION, { lat: 10, lng: 10 });
    expect(ws2.sent.at(-1)).toMatchObject({ type: 'location', lat: 10 });
  });

  it('backs off exponentially between reconnects', async () => {
    const { ws } = await connected();
    vi.spyOn(Math, 'random').mockReturnValue(1); // no jitter
    ws.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].drop();
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('viewer mode authenticates with the share token and stops when it expires', async () => {
    const statuses = [];
    const sock = new TrackingSocket({ url: 'ws://test/ws', shareToken: 's'.repeat(32), onStatus: (s) => statuses.push(s) });
    sock.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    expect(ws.sent[0]).toEqual({ type: 'auth_share', token: 's'.repeat(32) });
    ws.drop(4403);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses.at(-1)).toBe('expired');
  });
});

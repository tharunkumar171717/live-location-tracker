import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, connect, joinAs, makeUser, sessionWith, startServer } from './helpers.js';
import { query } from '../src/db.js';

let srv;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv?.close());

describe('WebSocket auth', () => {
  it('closes connections that never authenticate', async () => {
    const c = await connect(srv.wsUrl);
    const info = await c.closed;
    expect(info.code).toBe(4401);
  });

  it('rejects an invalid token and closes', async () => {
    const c = await connect(srv.wsUrl);
    c.send({ type: 'auth', token: 'not-a-jwt' });
    expect((await c.next('error')).code).toBe('unauthorized');
    expect((await c.closed).code).toBe(4401);
  });

  it('requires auth before anything else', async () => {
    const c = await connect(srv.wsUrl);
    c.send({ type: 'join', sessionId: '00000000-0000-4000-8000-000000000001' });
    expect((await c.next('error')).code).toBe('unauthorized');
    c.close();
  });
});

describe('WebSocket protocol validation', () => {
  it('rejects malformed messages with a readable reason', async () => {
    const user = await makeUser();
    const c = await joinAs(srv.wsUrl, user);
    c.send('{not json');
    expect((await c.next('error')).message).toBe('Invalid JSON');
    c.send({ type: 'join', sessionId: 'nope' });
    expect((await c.next('error')).message).toMatch(/sessionId/);
    c.send({ type: 'location', sessionId: '00000000-0000-4000-8000-000000000001', lat: 200, lng: 0 });
    expect((await c.next('error')).message).toMatch(/^lat:/);
    c.send({ type: 'teleport' });
    expect((await c.next('error')).code).toBe('bad_request');
    c.close();
  });
});

describe('rooms', () => {
  it('broadcasts a location to members of that session only', async () => {
    const owner = await makeUser('Owner');
    const friend = await makeUser('Friend');
    const outsider = await makeUser('Outsider');
    const session = await sessionWith(srv.base, owner, [friend]);
    const other = await sessionWith(srv.base, outsider);

    const a = await joinAs(srv.wsUrl, owner, session.id);
    const b = await joinAs(srv.wsUrl, friend, session.id);
    const x = await joinAs(srv.wsUrl, outsider, other.id);

    a.send({ type: 'location', sessionId: session.id, lat: 12.9716, lng: 77.5946, accuracy: 5 });
    const got = await b.next('location');
    expect(got).toMatchObject({ sessionId: session.id, userId: owner.id, lat: 12.9716, lng: 77.5946 });
    expect(await x.none('location')).toBe(true);
    [a, b, x].forEach((c) => c.close());
  });

  it("won't let a non-member join or post to a session", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const session = await sessionWith(srv.base, owner);
    const s = await joinAs(srv.wsUrl, stranger);
    s.send({ type: 'join', sessionId: session.id });
    expect((await s.next('error')).code).toBe('not_found');
    s.send({ type: 'location', sessionId: session.id, lat: 1, lng: 1 });
    expect((await s.next('error')).code).toBe('not_found');
    s.close();
  });

  it('tells a member they were removed when they leave via REST', async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const session = await sessionWith(srv.base, owner, [friend]);
    const f = await joinAs(srv.wsUrl, friend, session.id);
    await client(srv.base, friend.token).post(`/api/sessions/${session.id}/leave`);
    expect(await f.next('removed')).toMatchObject({ sessionId: session.id });
    f.close();
  });

  it('notifies everyone when the owner ends the session', async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const session = await sessionWith(srv.base, owner, [friend]);
    const f = await joinAs(srv.wsUrl, friend, session.id);
    await client(srv.base, owner.token).post(`/api/sessions/${session.id}/end`);
    await f.next('session_ended');
    f.send({ type: 'location', sessionId: session.id, lat: 1, lng: 1 });
    expect((await f.next('error')).code).toBe('session_ended');
    f.close();
  });
});

describe('rate limiting', () => {
  it('drops a flood of messages and says so', async () => {
    const user = await makeUser();
    const c = await joinAs(srv.wsUrl, user);
    for (let i = 0; i < 60; i++) c.send({ type: 'ping' });
    expect((await c.next((m) => m.code === 'rate_limited')).message).toBe('Slow down');
    await new Promise((r) => setTimeout(r, 100));
    // Bucket of 20 plus a little refill: well under 60 pongs.
    expect(c.messages.filter((m) => m.type === 'pong').length).toBeLessThan(30);
    c.close();
  });
});

describe('offline batches', () => {
  it('stores buffered points, acks them, and broadcasts only the newest', async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const session = await sessionWith(srv.base, owner, [friend]);
    const a = await joinAs(srv.wsUrl, owner, session.id);
    const b = await joinAs(srv.wsUrl, friend, session.id);

    const t0 = Date.now() - 60_000;
    const points = Array.from({ length: 30 }, (_, i) => ({
      lat: 12.9 + i * 0.0001,
      lng: 77.6,
      timestamp: t0 + i * 2000,
    }));
    a.send({ type: 'location_batch', sessionId: session.id, ref: 'b1', points });
    expect(await a.next('batch_ack')).toMatchObject({ ref: 'b1', accepted: 30 });

    const live = await b.next('location');
    expect(live.lat).toBeCloseTo(12.9 + 29 * 0.0001, 6);
    expect(await b.none('location', 200)).toBe(true);

    const { rows } = await query(
      'select count(*)::int as n from location_history where session_id = $1',
      [session.id],
    );
    expect(rows[0].n).toBe(30);
    [a, b].forEach((c) => c.close());
  });

  it('rejects oversized batches', async () => {
    const user = await makeUser();
    const session = await sessionWith(srv.base, user);
    const c = await joinAs(srv.wsUrl, user, session.id);
    const points = Array.from({ length: 501 }, () => ({ lat: 1, lng: 1 }));
    c.send({ type: 'location_batch', sessionId: session.id, points });
    expect((await c.next('error')).message).toMatch(/points/);
    c.close();
  });
});

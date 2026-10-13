import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, connect, joinAs, makeUser, startServer } from './helpers.js';
import { query } from '../src/db.js';
import { BOT_IDS, PUBLIC_DEMO_ID, ROUTES, botPosition, positionAlong } from '../src/demo/simulator.js';
import { distanceMeters } from '../src/lib/geo.js';

let srv;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv?.close());

describe('bot motion', () => {
  const route = ROUTES[0];
  it('wraps around the loop', () => {
    const a = positionAlong(route, 100);
    const b = positionAlong(route, 100 + route.length);
    expect(a.lat).toBeCloseTo(b.lat, 9);
    expect(a.lng).toBeCloseTo(b.lng, 9);
  });

  it('moves at the route speed', () => {
    const t = 1_700_000_000_000;
    const p1 = botPosition(route, 0, t);
    const p2 = botPosition(route, 0, t + 2000);
    // Road distance is 2 s * speed; straight-line can only be shorter (corners).
    const d = distanceMeters(p1, p2);
    expect(d).toBeGreaterThan(route.speedMps * 2 * 0.6);
    expect(d).toBeLessThanOrEqual(route.speedMps * 2 + 0.5);
  });
});

describe('public demo', () => {
  it('hands out a view link without sign-in and streams bot positions', async () => {
    const res = await client(srv.base).post('/public/demo');
    expect(res.status).toBe(201);

    const view = await client(srv.base).get(`/public/shares/${res.body.token}`);
    expect(view.body.session.id).toBe(PUBLIC_DEMO_ID);
    expect(view.body.geofences.length).toBeGreaterThan(0);

    const viewer = await connect(srv.wsUrl);
    viewer.send({ type: 'auth_share', token: res.body.token });
    await viewer.next('joined');
    await srv.demo.tick(PUBLIC_DEMO_ID);
    const seen = new Set();
    for (let i = 0; i < BOT_IDS.length; i++) seen.add((await viewer.next('location')).userId);
    expect([...seen].sort()).toEqual([...BOT_IDS].sort());
    viewer.close();
  });

  it('pauses bots when nobody has watched recently', async () => {
    await client(srv.base).post('/public/demo');
    await query(`update tracking_sessions set demo_active_until = now() - interval '1 minute' where id = $1`, [PUBLIC_DEMO_ID]);
    const before = (await query('select count(*)::int as n from location_history where session_id = $1', [PUBLIC_DEMO_ID])).rows[0].n;
    await srv.demo.tick(PUBLIC_DEMO_ID);
    const after = (await query('select count(*)::int as n from location_history where session_id = $1', [PUBLIC_DEMO_ID])).rows[0].n;
    expect(after).toBe(before);
  });
});

describe('guest demo', () => {
  it('creates a private session with bots and zones, reusing it on repeat', async () => {
    const guest = await makeUser('Guest', { anonymous: true });
    const api = client(srv.base, guest.token);
    const first = await api.post('/api/demo');
    expect(first.status).toBe(201);
    expect(first.body.is_demo).toBe(true);
    expect(first.body.members.filter((m) => m.is_bot)).toHaveLength(BOT_IDS.length);
    expect((await api.get(`/api/sessions/${first.body.id}/geofences`)).body.length).toBeGreaterThan(0);

    const again = await api.post('/api/demo');
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it('ends itself when it expires', async () => {
    const guest = await makeUser('Guest', { anonymous: true });
    const { body: session } = await client(srv.base, guest.token).post('/api/demo');
    const c = await joinAs(srv.wsUrl, guest, session.id);
    await query(`update tracking_sessions set expires_at = now() - interval '1 second' where id = $1`, [session.id]);
    await srv.demo.tick(session.id);
    await c.next('session_ended');
    c.close();
  });
});

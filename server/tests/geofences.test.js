import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, joinAs, makeUser, sessionWith, sleep, startServer } from './helpers.js';
import { zoneState } from '../src/services/geofences.js';

let srv;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv?.close());

const OFFICE = { lat: 12.9719, lng: 77.6412 };
// ~111 m per 0.001 deg of latitude.
const north = (m) => ({ lat: OFFICE.lat + m / 111_195, lng: OFFICE.lng });

describe('zoneState hysteresis', () => {
  const fence = { ...OFFICE, radius_m: 100 };
  it('is inside within the radius', () => expect(zoneState(fence, north(90))).toBe(true));
  it('is undecided just past the edge', () => expect(zoneState(fence, north(105))).toBe(null));
  it('is outside clearly past the edge', () => expect(zoneState(fence, north(130))).toBe(false));
  it('widens the band for inaccurate fixes', () => {
    expect(zoneState(fence, { ...north(130), accuracy: 45 })).toBe(null);
  });
});

describe('geofence alerts', () => {
  it('emits enter and exit once each, ignoring jitter at the edge', async () => {
    const owner = await makeUser('Owner');
    const rider = await makeUser('Rider');
    const session = await sessionWith(srv.base, owner, [rider]);
    const zone = await client(srv.base, owner.token).post(`/api/sessions/${session.id}/geofences`, {
      name: 'Office',
      ...OFFICE,
      radiusM: 100,
    });
    expect(zone.status).toBe(201);

    const watcher = await joinAs(srv.wsUrl, owner, session.id);
    const r = await joinAs(srv.wsUrl, rider, session.id);
    const at = (p) => r.send({ type: 'location', sessionId: session.id, ...p });

    at(north(400)); // first sighting outside: no event
    await sleep(100);
    at(north(50)); // enter
    const enter = await watcher.next('geofence');
    expect(enter).toMatchObject({ kind: 'enter', name: 'Office', userId: rider.id });

    at(north(105)); // edge band: no change
    await sleep(100);
    at(north(80)); // still inside
    await sleep(100);
    at(north(300)); // exit
    expect(await watcher.next('geofence')).toMatchObject({ kind: 'exit' });
    expect(await watcher.none('geofence', 300)).toBe(true);

    const events = await client(srv.base, owner.token).get(`/api/sessions/${session.id}/geofence-events`);
    expect(events.body.map((e) => e.kind)).toEqual(['exit', 'enter']);
    [watcher, r].forEach((c) => c.close());
  });

  it('tells members when zones change and enforces delete permissions', async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const session = await sessionWith(srv.base, owner, [friend]);
    const f = await joinAs(srv.wsUrl, friend, session.id);
    const zone = await client(srv.base, owner.token).post(`/api/sessions/${session.id}/geofences`, {
      name: 'Home',
      ...OFFICE,
    });
    await f.next('geofences_changed');
    expect(zone.body.radius_m).toBe(150); // default

    expect((await client(srv.base, friend.token).del(`/api/sessions/${session.id}/geofences/${zone.body.id}`)).status).toBe(403);
    expect((await client(srv.base, owner.token).del(`/api/sessions/${session.id}/geofences/${zone.body.id}`)).status).toBe(204);
    f.close();
  });

  it('validates zones', async () => {
    const owner = await makeUser();
    const session = await sessionWith(srv.base, owner);
    const api = client(srv.base, owner.token);
    expect((await api.post(`/api/sessions/${session.id}/geofences`, { name: '', ...OFFICE })).status).toBe(400);
    expect((await api.post(`/api/sessions/${session.id}/geofences`, { name: 'x', ...OFFICE, radiusM: 5 })).status).toBe(400);
  });
});

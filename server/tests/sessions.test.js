import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, makeUser, sessionWith, startServer } from './helpers.js';

let srv;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv?.close());

describe('REST auth', () => {
  it('rejects requests without a token', async () => {
    const res = await client(srv.base).get('/api/sessions');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const res = await client(srv.base, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad').get('/api/sessions');
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const user = await makeUser('Old', { expiresIn: '-1m' });
    const res = await client(srv.base, user.token).get('/api/sessions');
    expect(res.status).toBe(401);
  });
});

describe('sessions', () => {
  it('creates a session, joins by code, and lists members', async () => {
    const owner = await makeUser('Owner');
    const friend = await makeUser('Friend');
    const session = await sessionWith(srv.base, owner, [friend]);
    expect(session.join_code).toMatch(/^[A-Z2-9]{6}$/);

    const res = await client(srv.base, friend.token).get(`/api/sessions/${session.id}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('member');
    expect(res.body.members.map((m) => m.full_name).sort()).toEqual(['Friend', 'Owner']);
  });

  it('hides sessions from non-members with 404, not 403', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const session = await sessionWith(srv.base, owner);
    const res = await client(srv.base, stranger.token).get(`/api/sessions/${session.id}`);
    expect(res.status).toBe(404);
  });

  it('only lets the owner end a session, and the owner cannot leave', async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const session = await sessionWith(srv.base, owner, [friend]);

    expect((await client(srv.base, friend.token).post(`/api/sessions/${session.id}/end`)).status).toBe(403);
    expect((await client(srv.base, owner.token).post(`/api/sessions/${session.id}/leave`)).status).toBe(409);
    const ended = await client(srv.base, owner.token).post(`/api/sessions/${session.id}/end`);
    expect(ended.body.status).toBe('ended');

    const late = await makeUser();
    const join = await client(srv.base, late.token).post('/api/sessions/join', { code: session.join_code });
    expect(join.status).toBe(409);
  });

  it('accepts HTTP location fallback and validates coordinates', async () => {
    const owner = await makeUser();
    const session = await sessionWith(srv.base, owner);
    const api = client(srv.base, owner.token);
    expect((await api.post(`/api/sessions/${session.id}/locations`, { lat: 12.97, lng: 77.59 })).status).toBe(201);
    expect((await api.post(`/api/sessions/${session.id}/locations`, { lat: 120, lng: 77.59 })).status).toBe(400);
    const latest = await api.get(`/api/sessions/${session.id}/locations/latest`);
    expect(latest.body).toHaveLength(1);
    expect(latest.body[0]).toMatchObject({ user_id: owner.id, lat: 12.97, lng: 77.59 });
  });
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    expect((await client(srv.base).get('/health')).body).toEqual({ ok: true });
    const ready = await client(srv.base).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toEqual({ db: 'ok', bus: 'ok (memory)' });
  });

  it('serves Prometheus metrics', async () => {
    const res = await client(srv.base).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toContain('llt_ws_connections');
    expect(res.body).toContain('llt_http_request_duration_seconds');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, connect, joinAs, makeUser, sessionWith, startServer } from './helpers.js';
import { query } from '../src/db.js';

let srv;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv?.close());

async function shared() {
  const owner = await makeUser('Owner');
  const friend = await makeUser('Friend');
  const session = await sessionWith(srv.base, owner, [friend]);
  const link = await client(srv.base, friend.token).post(`/api/sessions/${session.id}/shares`, { ttlMinutes: 60 });
  return { owner, friend, session, link: link.body };
}

describe('share links', () => {
  it('creates a link that shows the token once and stores only a hash', async () => {
    const { session, link, owner } = await shared();
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const { rows } = await query('select token_hash from share_links where id = $1', [link.id]);
    expect(rows[0].token_hash).not.toContain(link.token);
    const list = await client(srv.base, owner.token).get(`/api/sessions/${session.id}/shares`);
    expect(list.body.links).toHaveLength(1);
    expect(list.body.links[0]).not.toHaveProperty('token');
  });

  it('only allows the offered expiry options', async () => {
    const owner = await makeUser();
    const session = await sessionWith(srv.base, owner);
    const res = await client(srv.base, owner.token).post(`/api/sessions/${session.id}/shares`, { ttlMinutes: 99999 });
    expect(res.status).toBe(400);
  });

  it('serves a public view with names but never emails', async () => {
    const { link } = await shared();
    const res = await client(srv.base).get(`/public/shares/${link.token}`);
    expect(res.status).toBe(200);
    expect(res.body.session.members.map((m) => m.full_name).sort()).toEqual(['Friend', 'Owner']);
    expect(JSON.stringify(res.body)).not.toContain('@example.test');
  });

  it('lets a viewer watch live but not send anything', async () => {
    const { owner, session, link } = await shared();
    const viewer = await connect(srv.wsUrl);
    viewer.send({ type: 'auth_share', token: link.token });
    expect(await viewer.next('auth_share_ok')).toMatchObject({ sessionId: session.id });
    await viewer.next('joined');

    const o = await joinAs(srv.wsUrl, owner, session.id);
    o.send({ type: 'location', sessionId: session.id, lat: 12.95, lng: 77.6 });
    expect(await viewer.next('location')).toMatchObject({ userId: owner.id });

    viewer.send({ type: 'location', sessionId: session.id, lat: 1, lng: 1 });
    expect((await viewer.next('error')).code).toBe('forbidden');
    viewer.send({ type: 'join', sessionId: '00000000-0000-4000-8000-000000000001' });
    expect((await viewer.next('error')).code).toBe('forbidden');
    [viewer, o].forEach((c) => c.close());
  });

  it('disconnects viewers when the link is revoked', async () => {
    const { friend, session, link } = await shared();
    const viewer = await connect(srv.wsUrl);
    viewer.send({ type: 'auth_share', token: link.token });
    await viewer.next('joined');
    const res = await client(srv.base, friend.token).del(`/api/sessions/${session.id}/shares/${link.id}`);
    expect(res.status).toBe(204);
    await viewer.next('share_revoked');
    expect((await viewer.closed).code).toBe(4403);
    expect((await client(srv.base).get(`/public/shares/${link.token}`)).status).toBe(404);
  });

  it('refuses expired links', async () => {
    const { link } = await shared();
    await query(`update share_links set expires_at = now() - interval '1 minute' where id = $1`, [link.id]);
    expect((await client(srv.base).get(`/public/shares/${link.token}`)).status).toBe(404);
    const viewer = await connect(srv.wsUrl);
    viewer.send({ type: 'auth_share', token: link.token });
    expect((await viewer.next('error')).code).toBe('unauthorized');
    expect((await viewer.closed).code).toBe(4401);
  });

  it('only lets the creator or owner revoke', async () => {
    const { session, link } = await shared();
    const third = await makeUser();
    await client(srv.base, third.token).post('/api/sessions/join', {
      code: (await query('select join_code from tracking_sessions where id = $1', [session.id])).rows[0].join_code,
    });
    const res = await client(srv.base, third.token).del(`/api/sessions/${session.id}/shares/${link.id}`);
    expect(res.status).toBe(403);
  });
});

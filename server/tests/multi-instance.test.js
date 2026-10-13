// Two server instances on one database, as behind a load balancer. With Redis
// a member on instance A sees points sent to instance B; with the in-memory
// bus they don't, which is exactly why the Redis bus exists.
import { afterAll, describe, expect, it } from 'vitest';
import { client, joinAs, makeUser, sessionWith, startServer } from './helpers.js';

const started = [];
afterAll(async () => {
  for (const s of started) await s.close();
});

async function pair(redisUrl) {
  const a = await startServer({ redisUrl });
  const b = await startServer({ redisUrl });
  started.push(a, b);
  return [a, b];
}

describe('scaling across instances', () => {
  it('delivers locations across instances through Redis', async () => {
    const [one, two] = await pair(process.env.TEST_REDIS_URL);
    const owner = await makeUser('On A');
    const friend = await makeUser('On B');
    const session = await sessionWith(one.base, owner, [friend]);

    const a = await joinAs(one.wsUrl, owner, session.id);
    const b = await joinAs(two.wsUrl, friend, session.id);
    a.send({ type: 'location', sessionId: session.id, lat: 12.97, lng: 77.59 });
    expect(await b.next('location')).toMatchObject({ userId: owner.id, lat: 12.97 });

    // Control events cross too: ending on instance B reaches the socket on A.
    await client(two.base, owner.token).post(`/api/sessions/${session.id}/end`);
    await a.next('session_ended');
    expect((await client(one.base).get('/ready')).body.checks.bus).toBe('ok (redis)');
    [a, b].forEach((c) => c.close());
  });

  it('does not cross instances with the in-memory bus', async () => {
    const [one, two] = await pair('');
    const owner = await makeUser();
    const friend = await makeUser();
    const session = await sessionWith(one.base, owner, [friend]);
    const a = await joinAs(one.wsUrl, owner, session.id);
    const b = await joinAs(two.wsUrl, friend, session.id);
    a.send({ type: 'location', sessionId: session.id, lat: 12.97, lng: 77.59 });
    expect(await b.none('location', 500)).toBe(true);
    [a, b].forEach((c) => c.close());
  });

  it('gives a demo lease to exactly one instance', async () => {
    const [one, two] = await pair(process.env.TEST_REDIS_URL);
    const key = `test:${Date.now()}`;
    expect(await one.bus.lease(key, 5000)).toBe(true);
    expect(await two.bus.lease(key, 5000)).toBe(false);
    expect(await one.bus.lease(key, 5000)).toBe(true); // renewal by the holder
  });
});

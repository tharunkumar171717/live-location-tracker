import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, makeUser, sessionWith, startServer } from './helpers.js';
import { query } from '../src/db.js';
import { runRetention } from '../src/jobs/retention.js';

let srv;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(() => srv?.close());

async function insertPoints(sessionId, userId, times) {
  await query(
    `insert into location_history (session_id, user_id, lat, lng, recorded_at)
     select $1, $2, 12.9, 77.6, unnest($3::timestamptz[])`,
    [sessionId, userId, times],
  );
}

describe('replay', () => {
  it("returns each member's track in time order", async () => {
    const owner = await makeUser();
    const friend = await makeUser();
    const session = await sessionWith(srv.base, owner, [friend]);
    const t0 = Date.now() - 600_000;
    await insertPoints(session.id, owner.id, [3, 1, 2].map((i) => new Date(t0 + i * 1000)));
    await insertPoints(session.id, friend.id, [new Date(t0 + 1500)]);

    const res = await client(srv.base, owner.token).get(`/api/sessions/${session.id}/replay`);
    expect(res.status).toBe(200);
    expect(res.body.points).toBe(4);
    expect(res.body.startedAt).toBe(t0 + 1000);
    expect(res.body.endedAt).toBe(t0 + 3000);
    expect(res.body.tracks[owner.id].map((p) => p[0])).toEqual([t0 + 1000, t0 + 2000, t0 + 3000]);
    expect(res.body.tracks[friend.id]).toHaveLength(1);
  });

  it('is members-only', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const session = await sessionWith(srv.base, owner);
    expect((await client(srv.base, stranger.token).get(`/api/sessions/${session.id}/replay`)).status).toBe(404);
  });
});

describe('retention', () => {
  it('deletes expired points and thins old ones to one per minute', async () => {
    const owner = await makeUser();
    const session = await sessionWith(srv.base, owner);
    const day = 86_400_000;
    const now = Date.now();
    const old = new Date(now - 40 * day); // past keepDays (30): deleted
    const mid = now - 10 * day; // past downsample (7): thinned
    const midMinute = Math.floor(mid / 60_000) * 60_000;
    const recent = new Date(now - 1000); // untouched

    await insertPoints(session.id, owner.id, [
      old,
      ...[0, 10, 20, 30].map((s) => new Date(midMinute + s * 1000)), // same minute -> 1 kept
      new Date(midMinute + 60_000), // next minute -> kept
      recent,
    ]);

    const result = await runRetention();
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(result.thinned).toBeGreaterThanOrEqual(3);

    const { rows } = await query(
      'select recorded_at from location_history where session_id = $1 order by recorded_at',
      [session.id],
    );
    expect(rows.map((r) => r.recorded_at.getTime())).toEqual([
      midMinute,
      midMinute + 60_000,
      recent.getTime(),
    ]);
  });
});

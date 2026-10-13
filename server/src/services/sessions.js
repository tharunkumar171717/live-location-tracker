import { randomInt } from 'node:crypto';
import { query, withTransaction } from '../db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// No 0/O/1/I to keep codes easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateJoinCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

const SESSION_COLUMNS = `s.id, s.owner_id, s.name, s.join_code, s.status, s.created_at, s.ended_at`;

export async function listSessionsForUser(userId) {
  const { rows } = await query(
    `select ${SESSION_COLUMNS}, m.role,
            (select count(*)::int from public.tracking_session_members x where x.session_id = s.id) as member_count
       from public.tracking_sessions s
       join public.tracking_session_members m on m.session_id = s.id and m.user_id = $1
      order by s.status = 'active' desc, s.created_at desc`,
    [userId],
  );
  return rows;
}

export async function createSession(userId, name) {
  return withTransaction(async (client) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await client.query('savepoint create_session');
        const { rows } = await client.query(
          `insert into public.tracking_sessions (owner_id, name, join_code)
           values ($1, $2, $3)
           returning id, owner_id, name, join_code, status, created_at, ended_at`,
          [userId, name, generateJoinCode()],
        );
        const session = rows[0];
        await client.query(
          `insert into public.tracking_session_members (session_id, user_id, role)
           values ($1, $2, 'owner')`,
          [session.id, userId],
        );
        return { ...session, role: 'owner' };
      } catch (err) {
        // Join code collision: retry with a new code.
        if (err.code === '23505' && err.constraint?.includes('join_code')) {
          await client.query('rollback to savepoint create_session');
          continue;
        }
        throw err;
      }
    }
    throw new HttpError(500, 'Could not allocate a join code');
  });
}

export async function joinSessionByCode(userId, code) {
  const { rows } = await query(
    `select id, status from public.tracking_sessions where join_code = $1`,
    [code.trim().toUpperCase()],
  );
  const session = rows[0];
  if (!session) throw new HttpError(404, 'No session with that code');
  if (session.status !== 'active') throw new HttpError(409, 'That session has ended');

  await query(
    `insert into public.tracking_session_members (session_id, user_id, role)
     values ($1, $2, 'member')
     on conflict do nothing`,
    [session.id, userId],
  );
  return getSessionForMember(userId, session.id);
}

// Returns the member's role, or null if the user isn't in the session.
export async function getMembership(userId, sessionId) {
  const { rows } = await query(
    `select m.role, s.status
       from public.tracking_session_members m
       join public.tracking_sessions s on s.id = m.session_id
      where m.session_id = $1 and m.user_id = $2`,
    [sessionId, userId],
  );
  return rows[0] || null;
}

export async function assertMember(userId, sessionId) {
  const membership = await getMembership(userId, sessionId);
  // 404 rather than 403 so non-members can't probe which session ids exist.
  if (!membership) throw new HttpError(404, 'Session not found');
  return membership;
}

export async function getSessionForMember(userId, sessionId) {
  const membership = await assertMember(userId, sessionId);
  const [{ rows: sessionRows }, { rows: members }] = await Promise.all([
    query(`select ${SESSION_COLUMNS} from public.tracking_sessions s where s.id = $1`, [sessionId]),
    query(
      `select m.user_id, m.role, m.joined_at, p.full_name, p.email, p.avatar_url
         from public.tracking_session_members m
         join public.profiles p on p.id = m.user_id
        where m.session_id = $1
        order by m.joined_at`,
      [sessionId],
    ),
  ]);
  return { ...sessionRows[0], role: membership.role, members };
}

export async function endSession(userId, sessionId) {
  const membership = await assertMember(userId, sessionId);
  if (membership.role !== 'owner') throw new HttpError(403, 'Only the owner can end a session');
  const { rows } = await query(
    `update public.tracking_sessions
        set status = 'ended', ended_at = coalesce(ended_at, now())
      where id = $1
      returning id, owner_id, name, join_code, status, created_at, ended_at`,
    [sessionId],
  );
  return rows[0];
}

export async function leaveSession(userId, sessionId) {
  const membership = await assertMember(userId, sessionId);
  if (membership.role === 'owner') throw new HttpError(409, 'The owner cannot leave; end the session instead');
  await query(
    `delete from public.tracking_session_members where session_id = $1 and user_id = $2`,
    [sessionId, userId],
  );
}

// Latest point for every member of the session.
export async function latestLocations(sessionId) {
  const { rows } = await query(
    `select distinct on (user_id)
            user_id, lat, lng, accuracy, heading, speed, recorded_at
       from public.location_history
      where session_id = $1
      order by user_id, recorded_at desc`,
    [sessionId],
  );
  return rows;
}

export async function locationTrail(sessionId, { userId, since, limit = 500 }) {
  const params = [sessionId];
  let where = 'session_id = $1';
  if (userId) {
    params.push(userId);
    where += ` and user_id = $${params.length}`;
  }
  if (since) {
    params.push(since);
    where += ` and recorded_at >= $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 500, 5000));
  const { rows } = await query(
    `select user_id, lat, lng, accuracy, heading, speed, recorded_at
       from public.location_history
      where ${where}
      order by recorded_at desc
      limit $${params.length}`,
    params,
  );
  return rows.reverse();
}

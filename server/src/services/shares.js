// View-only share links: "watch my trip for the next hour" without an account.
//
// The token is 24 random bytes (base64url) shown to the creator once; only its
// SHA-256 hash is stored. Links expire, can be revoked, and only ever grant
// read access to one session.
import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { HttpError, assertMember } from './sessions.js';

export const SHARE_TTL_MINUTES = [15, 60, 240, 480, 1440];
const MAX_ACTIVE_LINKS = 10;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function issueShareLink(createdBy, sessionId, ttlMinutes) {
  const token = randomBytes(24).toString('base64url');
  const { rows } = await query(
    `insert into public.share_links (session_id, created_by, token_hash, expires_at)
     values ($1, $2, $3, now() + make_interval(mins => $4))
     returning id, session_id, expires_at, created_at`,
    [sessionId, createdBy, hashToken(token), ttlMinutes],
  );
  return { ...rows[0], token };
}

export async function createShareLink(userId, sessionId, ttlMinutes) {
  const membership = await assertMember(userId, sessionId);
  if (membership.status !== 'active') throw new HttpError(409, 'Session has ended');
  const ttl = Number(ttlMinutes);
  if (!SHARE_TTL_MINUTES.includes(ttl)) {
    throw new HttpError(400, `ttlMinutes must be one of ${SHARE_TTL_MINUTES.join(', ')}`);
  }
  const { rows: [{ count }] } = await query(
    `select count(*)::int as count from public.share_links
      where session_id = $1 and revoked_at is null and expires_at > now()`,
    [sessionId],
  );
  if (count >= MAX_ACTIVE_LINKS) throw new HttpError(409, 'Too many active links; revoke one first');
  return issueShareLink(userId, sessionId, ttl);
}

export async function listShareLinks(userId, sessionId) {
  await assertMember(userId, sessionId);
  const { rows } = await query(
    `select l.id, l.created_by, p.full_name as created_by_name, l.expires_at, l.created_at
       from public.share_links l
       join public.profiles p on p.id = l.created_by
      where l.session_id = $1 and l.revoked_at is null and l.expires_at > now()
      order by l.created_at desc`,
    [sessionId],
  );
  return rows;
}

export async function revokeShareLink(userId, sessionId, shareId) {
  const membership = await assertMember(userId, sessionId);
  const { rows } = await query(
    'select created_by from public.share_links where id = $1 and session_id = $2 and revoked_at is null',
    [shareId, sessionId],
  );
  if (!rows[0]) throw new HttpError(404, 'Link not found');
  if (rows[0].created_by !== userId && membership.role !== 'owner') {
    throw new HttpError(403, 'Only the link creator or the session owner can revoke it');
  }
  await query('update public.share_links set revoked_at = now() where id = $1', [shareId]);
}

// Resolve a token to {shareId, sessionId, expiresAt}, or null if it's
// unknown, revoked, expired, or its session has ended.
export async function resolveShareToken(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  const { rows } = await query(
    `select l.id, l.session_id, l.expires_at
       from public.share_links l
       join public.tracking_sessions s on s.id = l.session_id
      where l.token_hash = $1 and l.revoked_at is null and l.expires_at > now()
        and s.status = 'active'`,
    [hashToken(token)],
  );
  const r = rows[0];
  return r ? { shareId: r.id, sessionId: r.session_id, expiresAt: new Date(r.expires_at).getTime() } : null;
}

import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { httpRateLimit } from '../rateLimit.js';
import { upsertProfile } from '../services/profiles.js';
import {
  HttpError,
  assertMember,
  createSession,
  endSession,
  getSessionForMember,
  joinSessionByCode,
  latestLocations,
  leaveSession,
  listSessionsForUser,
  locationTrail,
  replayTracks,
} from '../services/sessions.js';
import { SHARE_TTL_MINUTES, createShareLink, listShareLinks, revokeShareLink } from '../services/shares.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isoOrUndefined(value, name) {
  if (value == null || value === '') return undefined;
  const d = new Date(Number.isFinite(Number(value)) ? Number(value) : value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Invalid ${name}`);
  return d.toISOString();
}

export function createApi({ bus, recorder, geofences, demo }) {
  const api = Router();
  api.use(requireAuth);
  const limiter = httpRateLimit({
    name: 'http_user',
    ratePerMin: config.http.userRatePerMin,
    keyFn: (req) => `u:${req.user.id}`,
  });
  api.use(limiter);

  for (const name of ['sessionId', 'shareId', 'geofenceId']) {
    api.param(name, (req, res, next, id) => {
      if (!UUID_RE.test(id)) return next(new HttpError(404, 'Not found'));
      next();
    });
  }

  // Called by clients right after sign-in to create/update their profile.
  api.post('/me/profile', async (req, res) => {
    res.json(await upsertProfile(req.user));
  });

  api.get('/me', async (req, res) => {
    res.json({ id: req.user.id, email: req.user.email, isAnonymous: req.user.isAnonymous });
  });

  api.get('/sessions', async (req, res) => {
    res.json(await listSessionsForUser(req.user.id));
  });

  api.post('/sessions', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 100) throw new HttpError(400, 'Name must be 1-100 characters');
    await upsertProfile(req.user); // guarantees the FK target exists
    res.status(201).json(await createSession(req.user.id, name));
  });

  api.post('/sessions/join', async (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) throw new HttpError(400, 'Invalid join code');
    await upsertProfile(req.user);
    res.json(await joinSessionByCode(req.user.id, code));
  });

  // A private demo session with simulated riders and zones.
  api.post('/demo', async (req, res) => {
    await upsertProfile(req.user);
    const { id, reused } = await demo.createGuestDemo(req.user.id);
    res.status(reused ? 200 : 201).json(await getSessionForMember(req.user.id, id));
  });

  api.get('/sessions/:sessionId', async (req, res) => {
    res.json(await getSessionForMember(req.user.id, req.params.sessionId));
  });

  api.post('/sessions/:sessionId/end', async (req, res) => {
    const session = await endSession(req.user.id, req.params.sessionId);
    await bus.publish({ type: 'session_ended', sessionId: session.id });
    res.json(session);
  });

  api.post('/sessions/:sessionId/leave', async (req, res) => {
    await leaveSession(req.user.id, req.params.sessionId);
    await bus.publish({ type: 'evict', sessionId: req.params.sessionId, userId: req.user.id });
    res.status(204).end();
  });

  api.get('/sessions/:sessionId/locations/latest', async (req, res) => {
    await assertMember(req.user.id, req.params.sessionId);
    res.json(await latestLocations(req.params.sessionId));
  });

  api.get('/sessions/:sessionId/locations', async (req, res) => {
    await assertMember(req.user.id, req.params.sessionId);
    const { userId, since, limit } = req.query;
    if (userId && !UUID_RE.test(userId)) throw new HttpError(400, 'Invalid userId');
    res.json(await locationTrail(req.params.sessionId, { userId, since: isoOrUndefined(since, 'since'), limit }));
  });

  // HTTP fallback for location updates (e.g. background tasks without a socket).
  api.post('/sessions/:sessionId/locations', async (req, res) => {
    const event = await recorder.record(req.user.id, req.params.sessionId, req.body);
    res.status(event ? 201 : 202).json(event ?? { throttled: true });
  });

  // Trip replay: every member's track in time order.
  api.get('/sessions/:sessionId/replay', async (req, res) => {
    await assertMember(req.user.id, req.params.sessionId);
    res.json(
      await replayTracks(req.params.sessionId, {
        from: isoOrUndefined(req.query.from, 'from'),
        to: isoOrUndefined(req.query.to, 'to'),
      }),
    );
  });

  // View-only share links.
  api.get('/sessions/:sessionId/shares', async (req, res) => {
    res.json({ ttlOptions: SHARE_TTL_MINUTES, links: await listShareLinks(req.user.id, req.params.sessionId) });
  });

  api.post('/sessions/:sessionId/shares', async (req, res) => {
    res.status(201).json(await createShareLink(req.user.id, req.params.sessionId, req.body?.ttlMinutes));
  });

  api.delete('/sessions/:sessionId/shares/:shareId', async (req, res) => {
    await revokeShareLink(req.user.id, req.params.sessionId, req.params.shareId);
    await bus.publish({ type: 'share_revoked', sessionId: req.params.sessionId, shareId: req.params.shareId });
    res.status(204).end();
  });

  // Geofences.
  api.get('/sessions/:sessionId/geofences', async (req, res) => {
    await assertMember(req.user.id, req.params.sessionId);
    res.json(await geofences.list(req.params.sessionId));
  });

  api.post('/sessions/:sessionId/geofences', async (req, res) => {
    res.status(201).json(await geofences.create(req.user.id, req.params.sessionId, req.body));
  });

  api.delete('/sessions/:sessionId/geofences/:geofenceId', async (req, res) => {
    await geofences.remove(req.user.id, req.params.sessionId, req.params.geofenceId);
    res.status(204).end();
  });

  api.get('/sessions/:sessionId/geofence-events', async (req, res) => {
    await assertMember(req.user.id, req.params.sessionId);
    res.json(await geofences.events(req.params.sessionId, req.query.limit));
  });

  api.close = () => limiter.close();
  return api;
}

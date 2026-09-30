import { Router } from 'express';
import { requireAuth } from '../auth.js';
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
} from '../services/sessions.js';
import { recordLocation } from '../services/locations.js';
import { evictFromSession, notifySessionEnded } from '../ws/hub.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const api = Router();
api.use(requireAuth);

api.param('sessionId', (req, res, next, id) => {
  if (!UUID_RE.test(id)) return next(new HttpError(404, 'Session not found'));
  next();
});

// Called by clients right after sign-in to create/update their profile.
api.post('/me/profile', async (req, res) => {
  res.json(await upsertProfile(req.user));
});

api.get('/me', async (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
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

api.get('/sessions/:sessionId', async (req, res) => {
  res.json(await getSessionForMember(req.user.id, req.params.sessionId));
});

api.post('/sessions/:sessionId/end', async (req, res) => {
  const session = await endSession(req.user.id, req.params.sessionId);
  notifySessionEnded(session.id);
  res.json(session);
});

api.post('/sessions/:sessionId/leave', async (req, res) => {
  await leaveSession(req.user.id, req.params.sessionId);
  evictFromSession(req.params.sessionId, req.user.id);
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
  res.json(await locationTrail(req.params.sessionId, { userId, since, limit }));
});

// HTTP fallback for location updates (e.g. background tasks without a socket).
api.post('/sessions/:sessionId/locations', async (req, res) => {
  const event = await recordLocation(req.user.id, req.params.sessionId, req.body);
  res.status(event ? 201 : 202).json(event ?? { throttled: true });
});

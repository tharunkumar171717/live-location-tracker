// Routes that need no account: share-link views and the public demo.
// Rate limited per IP; they only ever expose names and positions, never emails.
import { Router } from 'express';
import { config } from '../config.js';
import { httpRateLimit } from '../rateLimit.js';
import { HttpError, latestLocations, publicSessionView } from '../services/sessions.js';
import { resolveShareToken } from '../services/shares.js';

export function createPublicApi({ geofences, demo }) {
  const pub = Router();
  const limiter = httpRateLimit({
    name: 'http_public',
    ratePerMin: config.http.publicRatePerMin,
    keyFn: (req) => `ip:${req.ip}`,
  });
  pub.use(limiter);

  async function viewFor(token) {
    const share = await resolveShareToken(token);
    if (!share) throw new HttpError(404, 'This link is invalid or has expired');
    return share;
  }

  // Everything a view-only page needs to render before the socket connects.
  pub.get('/shares/:token', async (req, res) => {
    const share = await viewFor(req.params.token);
    const [session, latest, zones] = await Promise.all([
      publicSessionView(share.sessionId),
      latestLocations(share.sessionId),
      geofences.list(share.sessionId),
    ]);
    res.json({
      session,
      latest,
      geofences: zones.map(({ id, name, lat, lng, radius_m }) => ({ id, name, lat, lng, radius_m })),
      expiresAt: new Date(share.expiresAt).toISOString(),
    });
  });

  pub.get('/shares/:token/geofence-events', async (req, res) => {
    const share = await viewFor(req.params.token);
    res.json(await geofences.events(share.sessionId, req.query.limit));
  });

  // "Watch the live demo": a short-lived view link to the public demo session.
  pub.post('/demo', async (req, res) => {
    const link = await demo.publicViewLink();
    res.status(201).json({ token: link.token, expiresAt: link.expires_at });
  });

  pub.close = () => limiter.close();
  return pub;
}

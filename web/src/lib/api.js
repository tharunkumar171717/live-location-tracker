import { getAccessToken } from './supabase.js';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000/ws';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function send(method, path, body, token) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

async function request(method, path, body) {
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, 'Not signed in');
  return send(method, `/api${path}`, body, token);
}

const s = (id) => `/sessions/${id}`;

export const api = {
  upsertProfile: () => request('POST', '/me/profile'),
  listSessions: () => request('GET', '/sessions'),
  createSession: (name) => request('POST', '/sessions', { name }),
  joinSession: (code) => request('POST', '/sessions/join', { code }),
  startDemo: () => request('POST', '/demo'),
  getSession: (id) => request('GET', s(id)),
  endSession: (id) => request('POST', `${s(id)}/end`),
  leaveSession: (id) => request('POST', `${s(id)}/leave`),
  replay: (id) => request('GET', `${s(id)}/replay`),

  listShares: (id) => request('GET', `${s(id)}/shares`),
  createShare: (id, ttlMinutes) => request('POST', `${s(id)}/shares`, { ttlMinutes }),
  revokeShare: (id, shareId) => request('DELETE', `${s(id)}/shares/${shareId}`),

  listGeofences: (id) => request('GET', `${s(id)}/geofences`),
  createGeofence: (id, zone) => request('POST', `${s(id)}/geofences`, zone),
  deleteGeofence: (id, zoneId) => request('DELETE', `${s(id)}/geofences/${zoneId}`),
  geofenceEvents: (id) => request('GET', `${s(id)}/geofence-events`),
};

// No account needed.
export const publicApi = {
  share: (token) => send('GET', `/public/shares/${encodeURIComponent(token)}`),
  shareEvents: (token) => send('GET', `/public/shares/${encodeURIComponent(token)}/geofence-events`),
  demoLink: () => send('POST', '/public/demo'),
};

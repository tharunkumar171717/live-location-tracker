import { getAccessToken } from './supabase.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, 'Not signed in');
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  upsertProfile: () => request('POST', '/me/profile'),
  listSessions: () => request('GET', '/sessions'),
  createSession: (name) => request('POST', '/sessions', { name }),
  joinSession: (code) => request('POST', '/sessions/join', { code }),
  getSession: (id) => request('GET', `/sessions/${id}`),
  endSession: (id) => request('POST', `/sessions/${id}/end`),
  leaveSession: (id) => request('POST', `/sessions/${id}/leave`),
};

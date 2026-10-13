import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, getAccessToken } from '../lib/supabase.js';
import { WS_URL } from '../lib/api.js';
import { TrackingSocket } from './TrackingSocket.js';

function toPoint(row) {
  return {
    userId: row.userId ?? row.user_id,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    heading: row.heading,
    speed: row.speed,
    recordedAt: row.recordedAt ?? row.recorded_at,
  };
}

const MAX_ALERTS = 20;

// Live state for one tracking session: positions keyed by userId, zone
// alerts, and connection status.
//
// Members pass a sessionId. Viewers of a share link pass {shareToken}; the
// server decides which session they see and they can't send.
export function useTrackingSession(sessionId, { shareToken } = {}) {
  const [positions, setPositions] = useState({});
  const [status, setStatus] = useState('connecting');
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [zonesVersion, setZonesVersion] = useState(0);
  const [queued, setQueued] = useState(0);
  const socketRef = useRef(null);
  const key = shareToken ? `share:${shareToken}` : sessionId;

  useEffect(() => {
    if (!key) return;
    setPositions({});
    setEnded(false);
    setError(null);
    setAlerts([]);
    let activeSession = sessionId;

    const socket = new TrackingSocket({
      url: WS_URL,
      getToken: getAccessToken,
      shareToken,
      onStatus: setStatus,
      onOutbox: (id, n) => id === sessionId && setQueued(n),
      onMessage: (msg) => {
        if (msg.type === 'auth_share_ok') activeSession = msg.sessionId;
        if (msg.sessionId && msg.sessionId !== activeSession) return;
        switch (msg.type) {
          case 'joined':
            setPositions(Object.fromEntries(msg.latest.map((r) => [r.user_id, toPoint(r)])));
            if (msg.status === 'ended') setEnded(true);
            break;
          case 'location':
            setPositions((prev) => ({ ...prev, [msg.userId]: toPoint(msg) }));
            break;
          case 'geofence':
            setAlerts((prev) => [msg, ...prev.filter((a) => a.id !== msg.id)].slice(0, MAX_ALERTS));
            break;
          case 'geofences_changed':
            setZonesVersion((v) => v + 1);
            break;
          case 'session_ended':
            setEnded(true);
            break;
          case 'removed':
            setError('You were removed from this session');
            break;
          case 'share_expired':
            setError('This link has expired');
            break;
          case 'share_revoked':
            setError('This link was revoked');
            break;
          case 'error':
            if (msg.code === 'session_ended') setEnded(true);
            else if (msg.code !== 'rate_limited') setError(msg.message);
            break;
        }
      },
    });
    socketRef.current = socket;
    if (!shareToken) socket.join(sessionId);
    socket.connect();

    // Hand refreshed tokens to the open socket so it stays authenticated.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (shareToken) return;
      if (event === 'TOKEN_REFRESHED' && session) socket.reauth(session.access_token);
      if (event === 'SIGNED_OUT') socket.close();
    });

    return () => {
      sub.subscription.unsubscribe();
      socket.close();
      socketRef.current = null;
    };
  }, [key, sessionId, shareToken]);

  const sendLocation = useCallback(
    (loc) => socketRef.current?.sendLocation(sessionId, loc),
    [sessionId],
  );

  // Seed alerts from history (newest first) without duplicating live ones.
  const seedAlerts = useCallback((history) => {
    setAlerts((prev) => {
      const seen = new Set(prev.map((a) => a.id));
      const old = history
        .filter((e) => !seen.has(e.id))
        .map((e) => ({ id: e.id, geofenceId: e.geofence_id, name: e.name, userId: e.user_id, kind: e.kind, occurredAt: e.occurred_at }));
      return [...prev, ...old].slice(0, MAX_ALERTS);
    });
  }, []);

  return { positions, status, ended, error, alerts, seedAlerts, zonesVersion, queued, sendLocation };
}

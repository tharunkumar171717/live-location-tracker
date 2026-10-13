import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, getAccessToken } from '../lib/supabase.js';
import { TrackingSocket } from './TrackingSocket.js';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000/ws';

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

// Live positions for one tracking session, keyed by userId.
export function useTrackingSession(sessionId) {
  const [positions, setPositions] = useState({});
  const [status, setStatus] = useState('connecting');
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return;
    setPositions({});
    setEnded(false);
    setError(null);

    const socket = new TrackingSocket({
      url: WS_URL,
      getToken: getAccessToken,
      onStatus: setStatus,
      onMessage: (msg) => {
        if (msg.sessionId && msg.sessionId !== sessionId) return;
        switch (msg.type) {
          case 'joined':
            setPositions(Object.fromEntries(msg.latest.map((r) => [r.user_id, toPoint(r)])));
            if (msg.status === 'ended') setEnded(true);
            break;
          case 'location':
            setPositions((prev) => ({ ...prev, [msg.userId]: toPoint(msg) }));
            break;
          case 'session_ended':
            setEnded(true);
            break;
          case 'removed':
            setError('You were removed from this session');
            break;
          case 'error':
            if (msg.code === 'session_ended') setEnded(true);
            else setError(msg.message);
            break;
        }
      },
    });
    socketRef.current = socket;
    socket.join(sessionId);
    socket.connect();

    // Hand refreshed tokens to the open socket so it stays authenticated.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) socket.reauth(session.access_token);
      if (event === 'SIGNED_OUT') socket.close();
    });

    return () => {
      sub.subscription.unsubscribe();
      socket.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  const sendLocation = useCallback(
    (loc) => socketRef.current?.sendLocation(sessionId, loc),
    [sessionId],
  );

  return { positions, status, ended, error, sendLocation };
}

import { useEffect, useRef, useState } from 'react';
import { RouteError, fetchRoute, progressOnRoute } from '../lib/route.js';
import { distanceMeters } from '../lib/geo.js';

const MIN_GAP_MS = 3000; // OSRM demo policy is <= 1 req/s; stay well under it
const ERROR_BACKOFF_MS = 15_000;
const TARGET_MOVED_M = 30; // refetch when a member target has moved this far
const OFF_ROUTE_M = 40; // refetch when we're this far from the route

// Road route from `from` to `to`, refetched only when needed. Progress along
// the route (remaining distance, ETA) is recomputed locally on every position
// change, so the numbers update instantly between fetches. Plain React,
// shared verbatim with the mobile app.
export function useRoute(from, to, mode) {
  const [route, setRoute] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const nextAllowedAt = useRef(0);
  const inFlight = useRef(null);
  const latest = useRef({ from, to, mode });
  latest.current = { from, to, mode };

  // Only use a route that matches the current mode and target.
  const current =
    route && to && route.mode === mode && distanceMeters(route.to, to) <= TARGET_MOVED_M ? route : null;
  const progress = current && from ? progressOnRoute(current, from) : null;

  const offRoute = progress && progress.offRoute > Math.max(OFF_ROUTE_M, from?.accuracy || 0);
  const needsFetch = Boolean(from && to && (!current || offRoute));
  const hardError = error instanceof RouteError && current == null && error.key === `${mode}:${to?.lat},${to?.lng}`;

  useEffect(() => {
    if (!needsFetch || inFlight.current || hardError) return;
    const wait = nextAllowedAt.current - Date.now();
    if (wait > 0) {
      const t = setTimeout(() => setRetryTick((n) => n + 1), wait);
      return () => clearTimeout(t);
    }

    const { from: f, to: t, mode: m } = latest.current;
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    nextAllowedAt.current = Date.now() + MIN_GAP_MS;
    setLoading(true);
    fetchRoute(f, t, m, ctrl.signal)
      .then((r) => {
        setRoute(r);
        setError(null);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // "No route" for this exact target won't change on retry; other errors back off.
        if (err instanceof RouteError) err.key = `${m}:${t.lat},${t.lng}`;
        else nextAllowedAt.current = Date.now() + ERROR_BACKOFF_MS;
        setError(err);
      })
      .finally(() => {
        if (inFlight.current === ctrl) inFlight.current = null;
        setLoading(false);
        setRetryTick((n) => n + 1);
      });
  }, [needsFetch, hardError, retryTick]);

  // Drop the route when the target is cleared, and cancel on unmount.
  useEffect(() => {
    if (!to) {
      setRoute(null);
      setError(null);
    }
  }, [to]);
  useEffect(() => () => inFlight.current?.abort(), []);

  return {
    route: current,
    progress,
    loading: loading && !current,
    rerouting: loading && Boolean(current),
    error: current ? null : error?.message || null,
  };
}

import { useEffect, useRef, useState } from 'react';

// Watches the browser's GPS while `enabled`, calling onPosition (if given) at
// most every `minIntervalMs`. Geolocation needs a secure context (https or localhost).
//
// watchPosition only fires when the browser thinks the position changed, and
// some phones go quiet for long stretches. If no fix arrives for POLL_MS we
// ask for a fresh one explicitly.
const POLL_MS = 3000;
const OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };

export function useGeolocation({ enabled, onPosition, minIntervalMs = 1200 }) {
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(null);
  const lastSent = useRef(0);
  const callback = useRef(onPosition);
  callback.current = onPosition;

  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this browser');
      return;
    }
    setError(null);
    lastSent.current = 0;

    let lastFixAt = Date.now();
    const onFix = (pos) => {
      lastFixAt = Date.now();
      setError(null);
      const loc = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      };
      setCurrent(loc);
      if (callback.current && Date.now() - lastSent.current >= minIntervalMs) {
        lastSent.current = Date.now();
        callback.current?.(loc);
      }
    };
    const onError = (err) => {
      // Timeouts are transient (e.g. indoors); keep the last fix and retry.
      if (err.code === err.PERMISSION_DENIED) {
        setError('Location permission denied. Allow it in your browser settings.');
      } else if (Date.now() - lastFixAt > 30_000) {
        setError(err.message || 'Could not get your location');
      }
    };

    const id = navigator.geolocation.watchPosition(onFix, onError, OPTIONS);
    const poll = setInterval(() => {
      if (Date.now() - lastFixAt >= POLL_MS) {
        navigator.geolocation.getCurrentPosition(onFix, onError, { ...OPTIONS, timeout: 10_000 });
      }
    }, POLL_MS);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(poll);
    };
  }, [enabled, minIntervalMs]);

  return { error, current };
}

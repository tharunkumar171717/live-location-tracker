import { useEffect, useRef, useState } from 'react';

// Watches the browser's GPS while `enabled`, calling onPosition (if given) at
// most every `minIntervalMs`. Geolocation needs a secure context (https or localhost).
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

    const id = navigator.geolocation.watchPosition(
      (pos) => {
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
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Allow it in your browser settings.'
            : err.message,
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, minIntervalMs]);

  return { error, current };
}

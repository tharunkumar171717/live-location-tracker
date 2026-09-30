import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

// Foreground GPS while `enabled`. Calls onPosition (if given) at most every `minIntervalMs`.
export function useDeviceLocation({ enabled, onPosition, minIntervalMs = 1200 }) {
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(null);
  const callback = useRef(onPosition);
  callback.current = onPosition;

  useEffect(() => {
    if (!enabled) return;
    let subscription = null;
    let cancelled = false;
    let lastSent = 0;

    (async () => {
      setError(null);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setError('Location permission denied. Enable it in Settings to share your location.');
        return;
      }
      subscription = await Location.watchPositionAsync(
        // Watch at 1 s / 1 m so on-screen distance stays live; sends are still
        // throttled to minIntervalMs below.
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
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
          if (callback.current && Date.now() - lastSent >= minIntervalMs) {
            lastSent = Date.now();
            callback.current?.(loc);
          }
        },
        (reason) => setError(String(reason)),
      );
      if (cancelled) subscription.remove();
    })().catch((e) => setError(e.message));

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled, minIntervalMs]);

  return { error, current };
}

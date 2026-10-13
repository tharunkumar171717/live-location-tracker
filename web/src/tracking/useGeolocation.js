import { useCallback, useEffect, useRef, useState } from 'react';
import { createSendPolicy } from './sendPolicy.js';

// Watches the browser's GPS while `enabled`. Every fix updates `current` (so
// your own marker is always live); onPosition is only called for fixes the
// battery-aware send policy picks. Needs a secure context (https or localhost).
//
// Desktops have no GPS chip, so a high-accuracy request can time out or fail
// outright. Until we have any fix, we also ask for an approximate (Wi-Fi / IP)
// position, and we report problems right away instead of looking stuck.
//
// watchPosition only fires when the browser thinks the position changed, and
// some phones go quiet for long stretches. If no fix arrives for POLL_MS we
// ask for a fresh one explicitly.
const POLL_MS = 3000;
const PRECISE = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };
const COARSE = { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 15_000 };

// status: 'locating' | 'ok' | 'denied' | 'unavailable' | 'unsupported'
export function useGeolocation({ enabled, onPosition }) {
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('locating');
  const [current, setCurrent] = useState(null);
  const [mode, setMode] = useState('moving');
  const [attempt, setAttempt] = useState(0);
  const callback = useRef(onPosition);
  callback.current = onPosition;
  const policy = useRef(null);
  policy.current ||= createSendPolicy();

  // Start each sharing stint with an immediate send.
  const sharing = Boolean(onPosition);
  useEffect(() => {
    if (sharing) policy.current.reset();
  }, [sharing]);

  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      setError('This browser cannot share location.');
      return;
    }
    setError(null);
    setStatus((s) => (s === 'ok' ? s : 'locating'));

    let hadFix = false;
    let blocked = false;
    let lastFixAt = Date.now();
    let polling = false;

    const onFix = (pos) => {
      hadFix = true;
      lastFixAt = Date.now();
      setError(null);
      setStatus('ok');
      const loc = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      };
      setCurrent(loc);
      if (!callback.current) return;
      const decision = policy.current.check(loc, { hidden: document.visibilityState === 'hidden' });
      setMode(decision.mode);
      if (decision.send) callback.current(loc);
    };

    const onError = (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        blocked = true;
        setStatus('denied');
        setError('Location permission is blocked for this site.');
        return;
      }
      // Once we've had a fix, short gaps (tunnels, indoors) are normal; only
      // complain if they last. Before the first fix, say so straight away.
      if (!hadFix) {
        setStatus('unavailable');
        setError('Your browser could not determine your location.');
      } else if (Date.now() - lastFixAt > 30_000) {
        setError(err.message || 'Lost your location');
      }
    };

    const request = (options) => {
      if (polling) return;
      polling = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          polling = false;
          onFix(pos);
        },
        (err) => {
          polling = false;
          onError(err);
        },
        options,
      );
    };

    const id = navigator.geolocation.watchPosition(onFix, onError, PRECISE);
    // An approximate first fix shows you on the map quickly, even without GPS.
    request(COARSE);
    const poll = setInterval(() => {
      if (Date.now() - lastFixAt >= POLL_MS) request(hadFix ? { ...PRECISE, timeout: 10_000 } : COARSE);
    }, POLL_MS);

    // Notice when the user unblocks location in site settings.
    let permission;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => {
        permission = p;
        if (p.state === 'denied') onError({ code: 1, PERMISSION_DENIED: 1 });
        // Unblocked in site settings: start over (see retry below for why a reload).
        p.onchange = () => {
          if (p.state !== 'denied' && blocked) window.location.reload();
        };
      })
      .catch(() => {});

    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(poll);
      if (permission) permission.onchange = null;
    };
  }, [enabled, attempt]);

  // After a permission block, browsers keep the page's pending requests
  // stalled even once the user allows location (~40 s in Chromium); a reload
  // gets a fix in under a second. Other problems can retry in place.
  const retry = useCallback(() => {
    if (status === 'denied') window.location.reload();
    else setAttempt((n) => n + 1);
  }, [status]);
  return { error, status, current, mode, retry };
}

// Browser-specific advice for the "can't find you" message.
export function locationHelp(status) {
  const brave = typeof navigator !== 'undefined' && Boolean(navigator.brave);
  if (status === 'denied') {
    return 'Click the icon at the left of the address bar, allow Location, then press Try again.';
  }
  if (brave) {
    return 'Brave needs "Use Google services for location" turned on (brave://settings/privacy). Or open this page on your phone.';
  }
  return 'Turn on location services for your device and browser, or open this page on your phone.';
}

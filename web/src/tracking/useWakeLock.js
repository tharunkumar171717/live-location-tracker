import { useEffect, useState } from 'react';

// Keeps the screen on while `active` (Screen Wake Lock API). Browsers stop GPS
// for pages that are fully backgrounded, so a screen that stays on is the
// honest way to keep sharing from a phone browser. The lock is dropped
// whenever the tab is hidden, so it's re-acquired on return.
export function useWakeLock(active) {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!active || !supported) return;
    let sentinel = null;
    let cancelled = false;

    async function acquire() {
      if (document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) return sentinel.release();
        setLocked(true);
        sentinel.addEventListener('release', () => setLocked(false));
      } catch {
        setLocked(false); // e.g. battery saver mode
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release().catch(() => {});
      setLocked(false);
    };
  }, [active, supported]);

  return { supported, locked };
}

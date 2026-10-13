// Decides which GPS fixes are worth sending, to save battery and data.
//
// Moving: send about every 1.5 s so others see smooth motion.
// Standing still: send only when you've actually moved, plus a heartbeat every
// 15 s so others know you're still there.
// Tab hidden (phone in pocket): back off to every 10 s even while moving.
import { distanceMeters } from '../lib/geo.js';

export const DEFAULTS = {
  movingIntervalMs: 1500,
  hiddenIntervalMs: 10_000,
  idleHeartbeatMs: 15_000,
  minMoveM: 8, // smaller moves are GPS noise
  idleSpeedMps: 0.6,
  idleAfterMs: 20_000, // this long without real movement = idle
};

export function createSendPolicy(options = {}) {
  const o = { ...DEFAULTS, ...options };
  let lastSent = null; // {loc, at}
  let lastMovedAt = 0;

  return {
    // Returns {send: boolean, mode: 'moving' | 'idle'}.
    check(loc, { now = Date.now(), hidden = false } = {}) {
      if (!lastSent) {
        lastMovedAt = now;
        lastSent = { loc, at: now };
        return { send: true, mode: 'moving' };
      }
      const moved = distanceMeters(lastSent.loc, loc);
      const fast = Number.isFinite(loc.speed) && loc.speed >= o.idleSpeedMps;
      if (moved >= o.minMoveM || fast) lastMovedAt = now;
      const mode = now - lastMovedAt < o.idleAfterMs ? 'moving' : 'idle';

      const since = now - lastSent.at;
      let send;
      if (mode === 'idle') send = moved >= o.minMoveM || since >= o.idleHeartbeatMs;
      else send = since >= (hidden ? o.hiddenIntervalMs : o.movingIntervalMs);

      if (send) lastSent = { loc, at: now };
      return { send, mode };
    },
    reset() {
      lastSent = null;
      lastMovedAt = 0;
    },
  };
}

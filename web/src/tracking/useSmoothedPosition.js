import { useEffect, useRef, useState } from 'react';
import { bearingDegrees, distanceMeters } from '../lib/geo.js';

// GPS delivers roughly one fix per second. Like map apps do, predict where a
// moving point is between fixes from its speed and heading, so the marker
// and distance move continuously instead of jumping once a second.

const TICK_MS = 200;
const MAX_EXTRAPOLATE_MS = 2500; // stop predicting if fixes stop arriving
const MIN_SPEED_MPS = 0.5; // below this, treat as standing still (GPS noise)
const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

// Point `meters` from `p` along compass bearing `bearing`.
function offset(p, meters, bearing) {
  const d = meters / EARTH_RADIUS_M;
  const b = toRad(bearing);
  const lat1 = toRad(p.lat);
  const lng1 = toRad(p.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

// fix: {lat, lng, speed?, heading?, recordedAt?} or null.
export function useSmoothedPosition(fix) {
  const last = useRef(null); // { fix, receivedAt }
  const [motion, setMotion] = useState(null); // { key, receivedAt, speed, heading } while moving
  const [, setTick] = useState(0);

  const key = fix ? `${fix.lat},${fix.lng},${fix.recordedAt ?? ''}` : null;
  useEffect(() => {
    if (!fix) {
      last.current = null;
      setMotion(null);
      return;
    }
    const receivedAt = Date.now();
    let speed = Number.isFinite(fix.speed) ? fix.speed : null;
    let heading = Number.isFinite(fix.heading) ? fix.heading : null;

    // Many browsers omit speed/heading; derive them from the previous fix.
    const prev = last.current;
    if (prev && (speed == null || heading == null)) {
      const dt = (receivedAt - prev.receivedAt) / 1000;
      const moved = distanceMeters(prev.fix, fix);
      if (dt > 0.2 && dt < 10) {
        if (speed == null) speed = moved / dt;
        if (heading == null && moved > 1) heading = bearingDegrees(prev.fix, fix);
      }
    }
    last.current = { fix, receivedAt };
    setMotion(speed != null && speed >= MIN_SPEED_MPS && heading != null ? { key, receivedAt, speed, heading } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Re-render a few times a second only while there's motion to predict.
  useEffect(() => {
    if (!motion) return;
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, [motion]);

  if (!fix) return null;
  if (!motion || motion.key !== key) return fix;
  const elapsed = Math.min(Date.now() - motion.receivedAt, MAX_EXTRAPOLATE_MS);
  return { ...fix, ...offset(fix, (motion.speed * elapsed) / 1000, motion.heading) };
}

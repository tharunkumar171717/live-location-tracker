// Trip replay helpers. A track is [[t, lat, lng, speed], ...] sorted by t.

// Position on a track at time t, interpolated between the surrounding points.
// Before the first point: null (they hadn't started sharing). After the last:
// the last point.
export function positionAt(track, t) {
  if (!track?.length || t < track[0][0]) return null;
  const last = track[track.length - 1];
  if (t >= last[0]) return { lat: last[1], lng: last[2], t: last[0], stale: t - last[0] > 60_000 };

  let lo = 0;
  let hi = track.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  // Don't draw a straight line across a long gap (app closed, offline).
  if (b[0] - a[0] > 120_000) return { lat: a[1], lng: a[2], t: a[0], stale: true };
  const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
  return { lat: a[1] + (b[1] - a[1]) * f, lng: a[2] + (b[2] - a[2]) * f, t, stale: false };
}

// The part of a track up to time t, as [[lat, lng], ...] for a polyline.
export function trailUntil(track, t) {
  if (!track?.length) return [];
  const out = [];
  for (const p of track) {
    if (p[0] > t) break;
    out.push([p[1], p[2]]);
  }
  const here = positionAt(track, t);
  if (here && !here.stale) out.push([here.lat, here.lng]);
  return out;
}

export function formatClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatSpan(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

// Road routing via the public OSRM servers run by FOSSGIS
// (https://routing.openstreetmap.de). Their usage policy allows light use:
// at most one request per second, so callers must throttle. Plain JS, shared
// verbatim with the mobile app.

const BASE = 'https://routing.openstreetmap.de';

export const TRAVEL_MODES = {
  car: { label: 'Drive', profile: 'routed-car' },
  bike: { label: 'Bike', profile: 'routed-bike' },
  foot: { label: 'Walk', profile: 'routed-foot' },
};

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;

// Local flat projection (metres) around `origin`; accurate over a few km,
// which is all we need to snap a position onto a nearby route segment.
function project(origin, p) {
  return {
    x: toRad(p.lng - origin.lng) * Math.cos(toRad(origin.lat)) * EARTH_RADIUS_M,
    y: toRad(p.lat - origin.lat) * EARTH_RADIUS_M,
  };
}

function segmentLength(a, b) {
  const q = project(a, b);
  return Math.hypot(q.x, q.y);
}

export class RouteError extends Error {}

// Returns { mode, from, to, distance (m), duration (s), coords: [{lat, lng}], cum: [m] }
// where cum[i] is the distance along the route to coords[i].
export async function fetchRoute(from, to, mode, signal) {
  const profile = TRAVEL_MODES[mode]?.profile;
  if (!profile) throw new RouteError(`Unknown travel mode ${mode}`);
  const url =
    `${BASE}/${profile}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=geojson&steps=false&alternatives=false';

  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => null);
  if (body?.code === 'NoRoute' || body?.code === 'NoSegment') throw new RouteError('No road route to this target');
  if (!res.ok || body?.code !== 'Ok' || !body.routes?.length) throw new RouteError('Routing service unavailable');

  const r = body.routes[0];
  const coords = r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  // OSRM starts and ends on the nearest road. Add the final off-road leg (to a
  // target in a park, building, etc.) as a straight line so the total isn't
  // shorter than the straight-line distance.
  const last = coords[coords.length - 1];
  if (last && segmentLength(last, to) > 1) coords.push({ lat: to.lat, lng: to.lng });
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + segmentLength(coords[i - 1], coords[i]));
  const distance = cum[cum.length - 1];
  return {
    mode,
    from,
    to,
    distance,
    // Keep OSRM's pace for the road part; walking pace (1.4 m/s) for the tail.
    duration: r.duration + Math.max(0, distance - r.distance) / 1.4,
    coords,
    cum,
  };
}

// Snap `pos` onto the route. Returns how far along the road is left, how far
// `pos` is from the route, and the remaining geometry for drawing.
export function progressOnRoute(route, pos) {
  const { coords, cum } = route;
  if (coords.length < 2) {
    return { remaining: route.distance, offRoute: 0, remainingCoords: coords, eta: route.duration };
  }

  let best = { dist: Infinity, index: 0, t: 0, point: coords[0] };
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = project(a, coords[i + 1]);
    const p = project(a, pos);
    const len2 = b.x * b.x + b.y * b.y;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / len2)) : 0;
    const dist = Math.hypot(p.x - t * b.x, p.y - t * b.y);
    if (dist < best.dist) {
      best = {
        dist,
        index: i,
        t,
        point: { lat: a.lat + t * (coords[i + 1].lat - a.lat), lng: a.lng + t * (coords[i + 1].lng - a.lng) },
      };
    }
  }

  const travelled = cum[best.index] + best.t * (cum[best.index + 1] - cum[best.index]);
  const remaining = Math.max(0, route.distance - travelled);
  return {
    remaining,
    offRoute: best.dist,
    remainingCoords: [best.point, ...coords.slice(best.index + 1)],
    eta: route.distance > 0 ? (route.duration * remaining) / route.distance : 0,
  };
}

export function formatDuration(seconds) {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

import { describe, expect, it } from 'vitest';
import { bearingDegrees, compassDirection, distanceMeters, formatDistance } from '../../src/lib/geo.js';
import { formatDuration, progressOnRoute } from '../../src/lib/route.js';
import { positionAt, trailUntil } from '../../src/lib/replay.js';

describe('geo', () => {
  it('measures MG Road to Koramangala at about 5 km', () => {
    const d = distanceMeters({ lat: 12.9756, lng: 77.6066 }, { lat: 12.9352, lng: 77.6245 });
    expect(d).toBeGreaterThan(4800);
    expect(d).toBeLessThan(5000);
  });

  it('gives compass bearings', () => {
    expect(compassDirection(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }))).toBe('N');
    expect(compassDirection(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }))).toBe('E');
  });

  it('formats distances with useful precision', () => {
    expect(formatDistance(42.4)).toBe('42 m');
    expect(formatDistance(1234)).toBe('1.234 km');
    expect(formatDistance(250_000)).toBe('250 km');
    expect(formatDuration(30)).toBe('1 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
  });
});

describe('route progress', () => {
  // Straight 2 km route due north.
  const coords = [0, 1000, 2000].map((m) => ({ lat: m / 111_195, lng: 0 }));
  const route = { coords, cum: [0, 1000, 2000], distance: 2000, duration: 200 };

  it('snaps a position onto the route and scales the ETA', () => {
    const p = progressOnRoute(route, { lat: 500 / 111_195, lng: 10 / 111_195 });
    expect(p.remaining).toBeCloseTo(1500, -1);
    expect(p.offRoute).toBeCloseTo(10, 0);
    expect(p.eta).toBeCloseTo(150, 0);
  });
});

describe('replay interpolation', () => {
  const track = [
    [1000, 10, 20],
    [2000, 11, 21],
    [500_000, 12, 22], // long gap before this point
  ];

  it('is null before the first point', () => expect(positionAt(track, 999)).toBeNull());

  it('interpolates between close points', () => {
    expect(positionAt(track, 1500)).toMatchObject({ lat: 10.5, lng: 20.5, stale: false });
  });

  it('holds position across long gaps instead of drawing through them', () => {
    expect(positionAt(track, 100_000)).toMatchObject({ lat: 11, lng: 21, stale: true });
  });

  it('builds the trail so far', () => {
    expect(trailUntil(track, 1500)).toEqual([[10, 20], [10.5, 20.5]]);
  });
});

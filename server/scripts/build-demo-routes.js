// Regenerates src/demo/routes.json: looped road routes in Bengaluru that the
// demo bots drive along. Run once (needs network): `node scripts/build-demo-routes.js`.
// Routes come from the public OSRM servers at routing.openstreetmap.de (light use only).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceMeters } from '../src/lib/geo.js';

const LOOPS = [
  {
    botId: '00000000-0000-4000-8000-00000000b001',
    name: 'Asha (demo)',
    profile: 'routed-car',
    speedMps: 9,
    // Koramangala -> Indiranagar 100 Ft Rd -> Domlur -> back
    waypoints: [[77.6245, 12.9352], [77.6412, 12.9719], [77.6387, 12.9610], [77.6245, 12.9352]],
  },
  {
    botId: '00000000-0000-4000-8000-00000000b002',
    name: 'Ravi (demo)',
    profile: 'routed-bike',
    speedMps: 5,
    // MG Road -> Cubbon Park -> Vidhana Soudha -> back
    waypoints: [[77.6066, 12.9756], [77.5929, 12.9763], [77.5906, 12.9796], [77.6066, 12.9756]],
  },
  {
    botId: '00000000-0000-4000-8000-00000000b003',
    name: 'Meera (demo)',
    profile: 'routed-bike',
    speedMps: 4.5,
    // HSR Layout loop
    waypoints: [[77.6473, 12.9116], [77.6380, 12.9150], [77.6400, 12.9230], [77.6510, 12.9195], [77.6473, 12.9116]],
  },
];

const MIN_STEP_M = 12;

async function route({ profile, waypoints }) {
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `https://routing.openstreetmap.de/${profile}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: { 'User-Agent': 'live-location-tracker demo route builder' } });
  const body = await res.json();
  if (body.code !== 'Ok') throw new Error(`${profile}: ${body.code} ${body.message || ''}`);
  const pts = body.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  // Drop points closer than MIN_STEP_M; the simulator interpolates anyway.
  const out = [pts[0]];
  for (const p of pts.slice(1)) if (distanceMeters(out[out.length - 1], p) >= MIN_STEP_M) out.push(p);
  return out.map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))]);
}

const routes = [];
for (const loop of LOOPS) {
  const path_ = await route(loop);
  routes.push({ botId: loop.botId, name: loop.name, speedMps: loop.speedMps, path: path_ });
  console.log(`${loop.name}: ${path_.length} points`);
  await new Promise((r) => setTimeout(r, 1500)); // OSRM policy: <= 1 req/s
}

const zones = [
  { name: 'Office · Indiranagar', lat: 12.9719, lng: 77.6412, radiusM: 250 },
  { name: 'Cubbon Park', lat: 12.9763, lng: 77.5929, radiusM: 300 },
];

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'demo', 'routes.json');
await writeFile(out, JSON.stringify({ routes, zones }) + '\n');
console.log(`wrote ${out}`);

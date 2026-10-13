// Regenerates the README screenshots and GIF (docs/assets/) from the real app.
//
//   1. start the stack:  (cd server && node scripts/e2e-server.js)
//                        (cd web && VITE_API_URL=http://localhost:4100 ... npx vite --port 3100)
//   2. node scripts/capture-media.mjs
//   3. ffmpeg turns the replay frames into docs/assets/replay.gif (command printed at the end)
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { BANGALORE, signedInContext } from '../tests/e2e/fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../docs/assets');
const frames = path.join(out, 'frames');
const WEB = 'http://localhost:3100';

Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5100/postgres',
  DB_SSL: 'false',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_PUBLISHABLE_KEY: 'e2e',
  LOG_LEVEL: 'silent',
});
const { query, pool } = await import('../../server/src/db.js');
const { ROUTES, botPosition } = await import('../../server/src/demo/simulator.js');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const viewport = { width: 1280, height: 760 };
const marker = (page, label) => page.locator('.leaflet-tooltip', { hasText: label });
// Wait until every visible map tile has loaded, so screenshots aren't grey.
async function settle(page) {
  await page
    .waitForFunction(() => document.querySelectorAll('.leaflet-tile:not(.leaflet-tile-loaded)').length === 0, null, {
      timeout: 20_000,
    })
    .catch(() => {});
  await page.waitForTimeout(300);
}

// 1. Public live demo -----------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/demo`);
  await marker(page, 'Asha (demo)').waitFor();
  await page.waitForTimeout(2500);
  await settle(page);
  await page.screenshot({ path: path.join(out, 'live-demo.png') });
  await ctx.close();
  console.log('live-demo.png');
}

// 2. A demo session with a friend, a route to a rider, and a zone alert ----------
const alice = await signedInContext(browser, 'Alice', BANGALORE.mgRoad);
const bob = await signedInContext(browser, 'Bob', BANGALORE.koramangala);
await alice.page.setViewportSize(viewport);
await alice.page.goto(`${WEB}/start-demo`);
await alice.page.getByRole('heading', { name: /Demo ride/ }).waitFor();
const sessionId = alice.page.url().split('/').pop();
const code = (await alice.page.locator('.code').textContent()).trim();

// Fifteen minutes of history so replay has something to show.
const now = Date.now();
const start = now - 15 * 60_000;
for (const [i, route] of ROUTES.entries()) {
  const times = [];
  const lats = [];
  const lngs = [];
  const speeds = [];
  for (let t = start; t < now - 5000; t += 3000) {
    const p = botPosition(route, i, t);
    times.push(new Date(t));
    lats.push(p.lat);
    lngs.push(p.lng);
    speeds.push(p.speed);
  }
  await query(
    `insert into location_history (session_id, user_id, lat, lng, speed, recorded_at)
     select $1, $2, * from unnest($3::float8[], $4::float8[], $5::float8[], $6::timestamptz[])`,
    [sessionId, route.botId, lats, lngs, speeds, times],
  );
}

await bob.page.goto(`${WEB}/`);
await bob.page.getByPlaceholder('ABC123').fill(code);
await bob.page.getByRole('button', { name: 'Join' }).click();
await bob.page.getByRole('heading', { name: /Demo ride/ }).waitFor();
await alice.page.reload();
await alice.page.getByRole('button', { name: 'Share my location' }).click();
await bob.page.getByRole('button', { name: 'Share my location' }).click();

// Route to Ravi, then Bob rides into the Cubbon Park zone.
await alice.page.locator('.member-list li', { hasText: 'Ravi (demo)' }).getByRole('button', { name: 'set as target' }).click();
await alice.page.locator('.distance').waitFor();
await alice.page.waitForTimeout(3000); // road route from OSRM
await bob.context.setGeolocation({ latitude: 12.9768, longitude: 77.5935, accuracy: 8 });
await alice.page.getByRole('status').filter({ hasText: 'Bob arrived at Cubbon Park' }).waitFor({ timeout: 20_000 });
await settle(alice.page);
await alice.page.screenshot({ path: path.join(out, 'session.png') });
console.log('session.png');

// 3. Replay frames -------------------------------------------------------------------
// Bob's fake GPS jump would draw a straight line across the city; replay the riders.
await query('delete from location_history where session_id = $1 and user_id = $2', [sessionId, bob.user.id]);
await alice.page.goto(`${WEB}/sessions/${sessionId}/replay`);
await alice.page.getByText(/points/).waitFor();
await alice.page.getByRole('tab', { name: '60×' }).click();
await settle(alice.page);
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });
await alice.page.getByRole('button', { name: /Play/ }).click();
const startedAt = Date.now();
let n = 0;
while (n < 160) {
  await alice.page.screenshot({ path: path.join(frames, `f${String(n++).padStart(3, '0')}.png`) });
  if (await alice.page.getByRole('button', { name: /Play/ }).isVisible()) break; // finished
}
const fps = Math.max(4, Math.round(n / ((Date.now() - startedAt) / 1000)));
await alice.page.screenshot({ path: path.join(out, 'replay.png') });
console.log(`replay: ${n} frames at ~${fps} fps`);

await Promise.all([alice.context.close(), bob.context.close()]);
await browser.close();
await pool.end();
console.log(
  `ffmpeg -y -framerate ${fps * 2} -i ${frames}/f%03d.png -vf "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer" ${out}/replay.gif`,
);

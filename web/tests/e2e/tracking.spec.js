import { expect, test } from '@playwright/test';
import { BANGALORE, signedInContext } from './fixtures.js';

const marker = (page, label) => page.locator('.leaflet-tooltip', { hasText: label });

test('public demo: watch simulated riders without signing in', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Watch live demo' }).click();
  await expect(page).toHaveURL(/\/share\//);
  await expect(page.getByRole('heading', { name: /Live demo/ })).toBeVisible();
  await expect(page.getByText('view-only')).toBeVisible();
  for (const name of ['Asha (demo)', 'Ravi (demo)', 'Meera (demo)']) {
    await expect(marker(page, name)).toBeVisible();
  }
  // Riders really move: a marker's position changes.
  const box = async () => marker(page, 'Asha (demo)').boundingBox();
  const before = await box();
  await expect.poll(async () => JSON.stringify(await box()), { timeout: 8000 }).not.toBe(JSON.stringify(before));
});

test('two members see each other live, share a view-only link, and get zone alerts', async ({ browser }) => {
  const alice = await signedInContext(browser, 'Alice', BANGALORE.mgRoad);
  const bob = await signedInContext(browser, 'Bob', BANGALORE.koramangala);

  // Alice starts a session.
  await alice.page.goto('/');
  await alice.page.getByPlaceholder('e.g. Weekend trip').fill('Team lunch');
  await alice.page.getByRole('button', { name: 'Create' }).click();
  await expect(alice.page.getByRole('heading', { name: 'Team lunch' })).toBeVisible();
  const code = (await alice.page.locator('.code').textContent()).trim();

  // Bob joins with the code.
  await bob.page.goto('/');
  await bob.page.getByPlaceholder('ABC123').fill(code);
  await bob.page.getByRole('button', { name: 'Join' }).click();
  await expect(bob.page.getByRole('heading', { name: 'Team lunch' })).toBeVisible();

  // Both share; each sees the other's marker.
  await alice.page.getByRole('button', { name: 'Share my location' }).click();
  await bob.page.getByRole('button', { name: 'Share my location' }).click();
  await expect(marker(alice.page, 'Bob')).toBeVisible();
  await expect(marker(bob.page, 'Alice')).toBeVisible();

  // A view-only link works in a fresh, signed-out browser.
  await alice.page.getByRole('button', { name: 'Create link' }).click();
  const url = await alice.page.getByLabel('Share link').inputValue();
  const viewer = await browser.newContext();
  const vpage = await viewer.newPage();
  await vpage.goto(new URL(url).pathname);
  await expect(vpage.getByText('view-only')).toBeVisible();
  await expect(marker(vpage, 'Alice')).toBeVisible();
  await expect(marker(vpage, 'Bob')).toBeVisible();

  // A zone on Cubbon Park (created via the API for an exact position; the
  // map-click flow has its own test below). Bob then rides into it.
  const sessionId = alice.page.url().split('/').pop();
  const res = await alice.page.request.post(`http://localhost:4100/api/sessions/${sessionId}/geofences`, {
    headers: { Authorization: `Bearer ${alice.user.token}` },
    data: { name: 'Cubbon Park', lat: BANGALORE.cubbonPark.latitude, lng: BANGALORE.cubbonPark.longitude, radiusM: 250 },
  });
  expect(res.status()).toBe(201);
  await expect(alice.page.locator('.panel', { hasText: 'Zones' }).getByText('Cubbon Park')).toBeVisible();

  await bob.context.setGeolocation({ ...BANGALORE.cubbonPark, accuracy: 10 });
  await expect(alice.page.getByRole('status')).toHaveText(/Bob arrived at Cubbon Park/, { timeout: 15_000 });
  await expect(vpage.locator('.panel', { hasText: 'Alerts' })).toContainText('Bob arrived at Cubbon Park');

  // Replay shows both tracks.
  await alice.page.getByRole('link', { name: /Replay this trip/ }).click();
  await expect(alice.page.getByRole('heading', { name: /Replay/ })).toBeVisible();
  await expect(alice.page.getByText(/points/)).toBeVisible();
  await alice.page.getByRole('button', { name: /Play/ }).click();
  await expect(marker(alice.page, 'Bob')).toBeVisible();

  await Promise.all([alice.context.close(), bob.context.close(), viewer.close()]);
});

test('placing a zone on the map through the UI', async ({ browser }) => {
  const carol = await signedInContext(browser, 'Carol', BANGALORE.mgRoad);
  await carol.page.goto('/');
  await carol.page.getByPlaceholder('e.g. Weekend trip').fill('Zones');
  await carol.page.getByRole('button', { name: 'Create' }).click();
  await carol.page.getByRole('button', { name: '+ Add zone' }).click();
  await expect(carol.page.getByText('Click the map to place the zone').first()).toBeVisible();
  await carol.page.locator('.leaflet-container').click({ position: { x: 300, y: 250 } });
  await carol.page.getByPlaceholder('e.g. Office').fill('Home');
  await carol.page.getByRole('button', { name: 'Save' }).click();
  await expect(carol.page.locator('.zone-tooltip', { hasText: 'Home' })).toBeVisible();
  await carol.context.close();
});

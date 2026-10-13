import { defineConfig, devices } from '@playwright/test';

// Starts the API (embedded Postgres, test tokens) and the web app, then drives
// real browsers with fake GPS. See tests/e2e/fixtures.js for how sign-in works.
const API = 'http://localhost:4100';
const WEB = 'http://localhost:3100';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    // Use a system Chromium when Playwright's own browser isn't installed.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: 'node scripts/e2e-server.js',
      cwd: '../server',
      url: `${API}/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 3100 --strictPort',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e',
        VITE_API_URL: API,
        VITE_WS_URL: 'ws://localhost:4100/ws',
        VITE_GOOGLE_CLIENT_ID: '',
      },
    },
  ],
});

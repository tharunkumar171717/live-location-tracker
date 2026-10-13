import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setup.js'],
    // One database for the whole run; files run one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 120_000,
  },
});

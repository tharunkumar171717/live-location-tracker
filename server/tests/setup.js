// Runs in each test worker before any test file imports src/ (config.js reads
// env at import time).
import { inject } from 'vitest';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: inject('databaseUrl'),
  TEST_REDIS_URL: inject('redisUrl'),
  REDIS_URL: '',
  DB_SSL: 'false',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
  LOCATION_MIN_INTERVAL_MS: '0',
  WS_AUTH_TIMEOUT_MS: '400',
  HTTP_PUBLIC_RATE_PER_MIN: '10000',
  DEMO_TICK_MS: '3600000', // tests call demo.tick() directly
  RETENTION_ENABLED: 'false',
});

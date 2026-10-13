import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

function num(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(n) ? n : fallback;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num('PORT', 4000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Railway / Docker put one proxy in front of us; needed for per-IP rate limits.
  trustProxy: num('TRUST_PROXY', 1),
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),

  supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
  supabasePublishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || '',

  db: {
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || undefined,
    port: num('DB_PORT', 5432),
    user: process.env.DB_USER || undefined,
    password: process.env.DB_PASSWORD || undefined,
    database: process.env.DB_NAME || 'postgres',
    ssl:
      process.env.DB_SSL === 'false'
        ? false
        : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
  },

  // Optional. When set, events fan out across server instances via Redis
  // pub/sub; without it everything stays in-process (single instance).
  redisUrl: process.env.REDIS_URL || '',

  locationMinIntervalMs: num('LOCATION_MIN_INTERVAL_MS', 1000),

  ws: {
    authTimeoutMs: num('WS_AUTH_TIMEOUT_MS', 10_000),
    heartbeatMs: num('WS_HEARTBEAT_MS', 30_000),
    // Token bucket per connection: sustained messages/second and burst size.
    ratePerSec: num('WS_RATE_PER_SEC', 10),
    rateBurst: num('WS_RATE_BURST', 20),
    maxSessionsPerSocket: num('WS_MAX_SESSIONS', 10),
  },

  http: {
    // Requests per minute per signed-in user, and per IP for public routes.
    userRatePerMin: num('HTTP_USER_RATE_PER_MIN', 240),
    publicRatePerMin: num('HTTP_PUBLIC_RATE_PER_MIN', 30),
  },

  retention: {
    enabled: process.env.RETENTION_ENABLED !== 'false',
    intervalMs: num('RETENTION_INTERVAL_MS', 60 * 60_000),
    // Points older than this are deleted.
    keepDays: num('RETENTION_KEEP_DAYS', 30),
    // Points older than this are thinned to one per user per minute.
    downsampleAfterDays: num('RETENTION_DOWNSAMPLE_AFTER_DAYS', 7),
    // History of demo sessions is only kept this long.
    demoKeepHours: num('RETENTION_DEMO_KEEP_HOURS', 24),
  },

  demo: {
    enabled: process.env.DEMO_ENABLED !== 'false',
    tickMs: num('DEMO_TICK_MS', 2000),
    // Guest demo sessions end on their own after this long.
    sessionMinutes: num('DEMO_SESSION_MINUTES', 30),
    // The public demo keeps simulating this long after its last viewer.
    idleMinutes: num('DEMO_IDLE_MINUTES', 10),
    viewTokenMinutes: num('DEMO_VIEW_TOKEN_MINUTES', 60),
  },

  // When set, GET /metrics requires `Authorization: Bearer <token>`.
  metricsToken: process.env.METRICS_TOKEN || '',
};

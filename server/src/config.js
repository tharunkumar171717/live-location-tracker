import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
  supabasePublishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || '',

  db: {
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || undefined,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || undefined,
    password: process.env.DB_PASSWORD || undefined,
    database: process.env.DB_NAME || 'postgres',
    ssl:
      process.env.DB_SSL === 'false'
        ? false
        : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
  },

  locationMinIntervalMs: Number(process.env.LOCATION_MIN_INTERVAL_MS || 1000),
};

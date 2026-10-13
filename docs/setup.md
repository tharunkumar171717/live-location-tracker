# Setup

How to run G-Map against your own Supabase project, and how it's deployed.
For a quick look without any accounts, use `docker compose up --build` instead (see the README).

## 1. Supabase

1. Create a project. Copy its **URL**, **publishable key** and the **session pooler** connection
   string (port 5432; the transaction pooler on 6543 doesn't support prepared statements).
2. **Database**: from `server/`, with `DATABASE_URL` set, run `npm run migrate`. It applies
   `db/migrations/*.sql` in order and records them in `public.schema_migrations`, so it's safe to re-run.
3. **Google sign-in** (optional): Authentication → Sign In / Providers → Google → enable, and paste the
   Google OAuth client ID and secret. In Google Cloud Console, the OAuth client's *Authorized redirect
   URI* must be `https://<project-ref>.supabase.co/auth/v1/callback`.
4. **Guest mode** (the "Try as guest" button): Authentication → Sign In / Providers → enable
   **Allow anonymous sign-ins**. Consider turning on CAPTCHA if the app is public. Without this,
   "Watch live demo" still works; only guest sessions are unavailable.
5. **Redirect URLs**: Authentication → URL Configuration → add `http://localhost:3000/auth/callback`
   (and your production URL + `/auth/callback`).

## 2. Run

```sh
cp server/.env.example server/.env   # fill in DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
cp web/.env.example web/.env         # fill in VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY

cd server && npm install && npm run dev   # http://localhost:4000, ws://localhost:4000/ws
cd web && npm install && npm run dev      # http://localhost:3000
```

Every server setting is documented in [`server/.env.example`](../server/.env.example): rate limits,
retention, demo mode, `REDIS_URL`, `METRICS_TOKEN`.

## 3. Deploy

| Part | Host | Settings |
|---|---|---|
| Web | Vercel | Project root `web/`. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL=https://<api-domain>`, `VITE_WS_URL=wss://<api-domain>/ws`, optional `VITE_GOOGLE_CLIENT_ID` |
| API | Render (or Railway, see `railway.json`) | Root `server/`, start `npm start`, health check `/ready`. Env: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=false`, `CORS_ORIGINS=https://<web-domain>`. The host sets `PORT`. |
| Redis | optional | Add a Redis instance (e.g. Render Key Value) and set `REDIS_URL` only when you run more than one API instance. |

Supabase's redirect URLs must include `https://<web-domain>/auth/callback`.

## 4. Regenerating assets

- **Demo routes**: `cd server && node scripts/build-demo-routes.js` (fetches road loops from OSRM).
- **Social card**: render `docs/assets/og-card.html` at 1200×630 to `web/public/og-image.png`.
- **README screenshots and GIF**: start the E2E stack (see `web/playwright.config.js`), then
  `cd web && node scripts/capture-media.mjs`.

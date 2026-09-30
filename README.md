# Live Location Tracker

```
Google ⇄ Supabase Auth ⇄ web (React/Vite)
                              │ access token
                              ▼
                  Node server: REST /api + WebSocket /ws
                              │
                  Supabase Postgres (profiles → tracking_sessions → location_history)
```

| Folder    | What                                   | Port |
|-----------|----------------------------------------|------|
| `server/` | Express + `ws`, verifies Supabase JWTs | 4000 |
| `web/`    | React + Vite + Leaflet (OpenStreetMap) | 3000 |

## One-time Supabase setup

1. **Database**: `cd server && npm run migrate` (already applied once).
2. **Google provider**: Supabase → Authentication → Sign In / Providers → Google → enable,
   paste the Google OAuth **client ID and secret** there. The secret lives only in Supabase.
   In Google Cloud Console, the OAuth client's *Authorized redirect URI* must be
   `https://jisgtfioddrtpqscbbnt.supabase.co/auth/v1/callback`.
3. **Redirect URLs**: Supabase → Authentication → URL Configuration → add
   - `http://localhost:3000/auth/callback` (web)

## Run

```sh
cd server && npm run dev          # http://localhost:4000, ws://localhost:4000/ws
cd web && npm run dev             # http://localhost:3000
```

## Security model

- Clients authenticate with Supabase only; the server never sees passwords.
- Every REST call sends `Authorization: Bearer <access token>`; the WebSocket sends
  `{type:"auth", token}` as its first message (not in the URL, so it stays out of logs).
- The server verifies tokens against the project's JWKS (ES256) and derives the user id
  from the token. Any `userId` a client sends is ignored.
- Creating, joining, sending locations, and viewing locations all check session membership
  in the database; non-members get 404. Only owners can end a session.
- RLS is enabled on all tables as a second line of defence.

## WebSocket protocol

See the header comment in [`server/src/ws/hub.js`](server/src/ws/hub.js).

## Next: optional Kafka

`server/src/bus.js` is the seam. Producers call `locationBus.publish()`, and the WebSocket
broadcaster subscribes. Swapping in a Kafka producer + consumer group there lets multiple
server instances share location events without changing any other code.

## Deployment

| Part    | Host    | URL |
|---------|---------|-----|
| Web     | Vercel  | https://live-location-tracker-amber.vercel.app |
| Server  | Railway | root directory `server/` (see `server/railway.json`) |

Vercel can't host the server: its functions don't keep WebSocket connections open.

**Railway variables** (copy values from `server/.env`): `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=false`,
`CORS_ORIGINS=https://live-location-tracker-amber.vercel.app,http://localhost:3000`.
Railway sets `PORT` itself.

**Vercel variables** (project root `web/`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_API_URL=https://<railway-domain>`, `VITE_WS_URL=wss://<railway-domain>/ws`.

**Supabase redirect URLs** must also include `https://live-location-tracker-amber.vercel.app/auth/callback`.

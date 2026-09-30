# Live Location Tracker

```
Google ⇄ Supabase Auth ⇄ web (React/Vite) + mobile (Expo, Android)
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
| `mobile/` | Expo SDK 57 + Expo Router + react-native-maps | – |

## One-time Supabase setup

1. **Database**: `cd server && npm run migrate` (already applied once).
2. **Google provider**: Supabase → Authentication → Sign In / Providers → Google → enable,
   paste the Google OAuth **client ID and secret** there. The secret lives only in Supabase.
   In Google Cloud Console, the OAuth client's *Authorized redirect URI* must be
   `https://jisgtfioddrtpqscbbnt.supabase.co/auth/v1/callback`.
3. **Redirect URLs**: Supabase → Authentication → URL Configuration → add
   - `http://localhost:3000/auth/callback` (web)
   - `gmap://auth/callback` (Android dev/release build)
   - `exp://**` (only if you test in Expo Go)

## Run

```sh
cd server && npm run dev          # http://localhost:4000, ws://localhost:4000/ws
cd web && npm run dev             # http://localhost:3000
cd mobile && npm run android      # builds a dev build onto an emulator/device
```

Mobile networking: the emulator reaches your Mac at `10.0.2.2` (default in `mobile/.env`).
On a physical phone set `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WS_URL` to your Mac's LAN IP.
Maps on Android need `GOOGLE_MAPS_ANDROID_API_KEY` in `mobile/.env` (Maps SDK for Android).

## Security model

- Clients authenticate with Supabase only; the server never sees passwords.
- Every REST call sends `Authorization: Bearer <access token>`; the WebSocket sends
  `{type:"auth", token}` as its first message (not in the URL, so it stays out of logs).
- The server verifies tokens against the project's JWKS (ES256) and derives the user id
  from the token. Any `userId` a client sends is ignored.
- Creating, joining, sending locations, and viewing locations all check session membership
  in the database; non-members get 404. Only owners can end a session.
- RLS is enabled on all tables as a second line of defence.
- Mobile sessions are AES-encrypted at rest with the key in Android Keystore (SecureStore).

## WebSocket protocol

See the header comment in [`server/src/ws/hub.js`](server/src/ws/hub.js).

## Next: optional Kafka

`server/src/bus.js` is the seam. Producers call `locationBus.publish()`, and the WebSocket
broadcaster subscribes. Swapping in a Kafka producer + consumer group there lets multiple
server instances share location events without changing any other code.

// Signed-in browser contexts without a real Supabase project.
//
// supabase-js keeps its session in localStorage under sb-<host>-auth-token.
// We put a session there whose access token is signed with the e2e server's
// HS256 secret, so the server verifies it exactly as it would a real token.
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';

const SECRET = 'e2e-jwt-secret-at-least-32-characters';
const ISSUER = 'http://localhost:54321/auth/v1';
const STORAGE_KEY = 'sb-localhost-auth-token';

export const BANGALORE = {
  mgRoad: { latitude: 12.9756, longitude: 77.6066 },
  cubbonPark: { latitude: 12.9763, longitude: 77.5929 },
  koramangala: { latitude: 12.9352, longitude: 77.6245 },
};

export async function makeSession(name) {
  const id = randomUUID();
  const email = `${name.toLowerCase()}-${id.slice(0, 6)}@example.test`;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user_metadata = { full_name: name };
  const access_token = await new SignJWT({ email, role: 'authenticated', is_anonymous: false, user_metadata })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(SECRET));
  return {
    id,
    name,
    token: access_token,
    session: {
      access_token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: exp,
      refresh_token: 'e2e-refresh-token',
      user: {
        id,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        app_metadata: { provider: 'email' },
        user_metadata,
        is_anonymous: false,
        created_at: new Date().toISOString(),
      },
    },
  };
}

// A browser context signed in as `name`, standing at `position`.
export async function signedInContext(browser, name, position) {
  const user = await makeSession(name);
  const context = await browser.newContext({
    geolocation: { ...position, accuracy: 10 },
    permissions: ['geolocation'],
  });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(user.session)],
  );
  const page = await context.newPage();
  return { user, context, page };
}

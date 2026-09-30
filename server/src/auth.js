// Verifies Supabase access tokens. The user's identity always comes from a
// validated token -- never from a userId supplied by the client.
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { config } from './config.js';

const issuer = `${config.supabaseUrl}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const hsSecret = config.supabaseJwtSecret
  ? new TextEncoder().encode(config.supabaseJwtSecret)
  : null;

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.status = 401;
  }
}

function toUser(claims) {
  const meta = claims.user_metadata || {};
  return {
    id: claims.sub,
    email: claims.email ?? null,
    fullName: meta.full_name || meta.name || null,
    avatarUrl: meta.avatar_url || meta.picture || null,
    expiresAt: claims.exp ? claims.exp * 1000 : null,
  };
}

// Fallback for HS256 tokens when the legacy JWT secret isn't configured:
// ask Supabase Auth to validate the token.
async function verifyRemotely(token) {
  const res = await fetch(`${issuer}/user`, {
    headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AuthError('Invalid or expired token');
  const user = await res.json();
  // /user doesn't return exp; read it from the (now validated) payload.
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return toUser({ ...payload, sub: user.id, email: user.email, user_metadata: user.user_metadata });
}

export async function verifyAccessToken(token) {
  if (!token || typeof token !== 'string') throw new AuthError('Missing token');

  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new AuthError('Malformed token');
  }

  try {
    if (header.alg === 'HS256') {
      if (!hsSecret) return await verifyRemotely(token);
      const { payload } = await jwtVerify(token, hsSecret, { issuer, audience: 'authenticated' });
      return toUser(payload);
    }
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
    return toUser(payload);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Invalid or expired token');
  }
}

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : null;
}

// Express middleware: sets req.user from the Authorization header.
export async function requireAuth(req, res, next) {
  try {
    req.user = await verifyAccessToken(bearerToken(req));
    next();
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
  }
}

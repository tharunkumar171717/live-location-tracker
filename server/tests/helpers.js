import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import WebSocket from 'ws';

// A Supabase-style access token signed with the test HS256 secret.
export async function makeUser(name = 'Test User', { expiresIn = '1h', anonymous = false } = {}) {
  const id = randomUUID();
  const email = anonymous ? null : `${id.slice(0, 8)}@example.test`;
  const token = await new SignJWT({
    email,
    role: 'authenticated',
    is_anonymous: anonymous,
    user_metadata: { full_name: name },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
  return { id, name, email, token };
}

export async function startServer(opts = {}) {
  const { createServer } = await import('../src/app.js');
  const instance = await createServer({ jobs: false, ...opts });
  const port = await instance.listen(0);
  return {
    ...instance,
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  };
}

export function client(base, token) {
  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, body: data, headers: res.headers };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    del: (p) => call('DELETE', p),
  };
}

// A WebSocket that records every message so tests can wait for one.
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const messages = [];
  const waiters = [];
  let closeInfo = null;
  const closed = new Promise((resolve) => {
    ws.on('close', (code, reason) => {
      closeInfo = { code, reason: reason.toString() };
      resolve(closeInfo);
    });
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    messages.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  return {
    ws,
    messages,
    closed,
    get closeInfo() {
      return closeInfo;
    },
    send: (msg) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
    // Resolves with the first message (already received or future) matching pred.
    next(pred, timeoutMs = 3000) {
      const match = typeof pred === 'string' ? (m) => m.type === pred : pred;
      const seen = messages.find(match);
      if (seen) {
        messages.splice(messages.indexOf(seen), 1);
        return Promise.resolve(seen);
      }
      return new Promise((resolve, reject) => {
        const w = {
          pred: match,
          resolve: (m) => {
            clearTimeout(timer);
            messages.splice(messages.indexOf(m), 1);
            resolve(m);
          },
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`Timed out waiting for message (have: ${JSON.stringify(messages.map((m) => m.type))})`));
        }, timeoutMs);
        waiters.push(w);
      });
    },
    // Asserts nothing matching arrives within ms.
    async none(pred, ms = 400) {
      const match = typeof pred === 'string' ? (m) => m.type === pred : pred;
      await new Promise((r) => setTimeout(r, ms));
      return !messages.some(match);
    },
    close: () => ws.close(),
  };
}

// Connected, authenticated, and joined to a session.
export async function joinAs(wsUrl, user, sessionId) {
  const c = await connect(wsUrl);
  c.send({ type: 'auth', token: user.token });
  await c.next('auth_ok');
  if (sessionId) {
    c.send({ type: 'join', sessionId });
    await c.next('joined');
  }
  return c;
}

// A session owned by `owner` that `others` have joined.
export async function sessionWith(api, owner, others = []) {
  const res = await client(api, owner.token).post('/api/sessions', { name: 'Test trip' });
  for (const u of others) {
    await client(api, u.token).post('/api/sessions/join', { code: res.body.join_code });
  }
  return res.body;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Client for the /ws tracking protocol (see server/src/ws/hub.js).
// Handles auth handshake, token refresh, rejoining sessions after reconnects,
// and exponential backoff. Plain JS, shared verbatim with the mobile app.

export class TrackingSocket {
  constructor({ url, getToken, onMessage, onStatus }) {
    this.url = url;
    this.getToken = getToken; // async () => access token | null
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.sessions = new Set();
    this.pending = new Map(); // sessionId -> latest unsent location
    this.ws = null;
    this.ready = false;
    this.closed = false;
    this.attempt = 0;
    this.retryTimer = null;
  }

  connect() {
    this.closed = false;
    this.open();
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.ws?.close(1000, 'Client closed');
    this.ws = null;
    this.setReady(false, 'closed');
  }

  join(sessionId) {
    this.sessions.add(sessionId);
    if (this.ready) this.send({ type: 'join', sessionId });
  }

  leave(sessionId) {
    this.sessions.delete(sessionId);
    this.pending.delete(sessionId);
    if (this.ready) this.send({ type: 'leave', sessionId });
  }

  // Only the latest position matters; if offline, keep just the newest one.
  sendLocation(sessionId, location) {
    const msg = { type: 'location', sessionId, ...location };
    if (this.ready) this.send(msg);
    else this.pending.set(sessionId, msg);
  }

  // Call when the auth library refreshes the access token.
  async reauth(token) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const t = token || (await this.getToken());
    if (t) this.send({ type: 'auth', token: t });
  }

  // --- internals ---

  setReady(ready, status) {
    this.ready = ready;
    this.onStatus(status);
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  async open() {
    this.setReady(false, this.attempt ? 'reconnecting' : 'connecting');
    const token = await this.getToken();
    if (this.closed) return;
    if (!token) {
      this.setReady(false, 'unauthenticated');
      return;
    }

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'auth_ok') {
        const wasReady = this.ready;
        this.attempt = 0;
        this.setReady(true, 'connected');
        if (!wasReady) {
          for (const id of this.sessions) this.send({ type: 'join', sessionId: id });
          for (const m of this.pending.values()) this.send(m);
          this.pending.clear();
        }
      } else if (msg.type === 'auth_expired') {
        this.reauth();
      }
      this.onMessage(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed) return;
      this.setReady(false, 'reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt) * (0.5 + Math.random() / 2);
      this.attempt += 1;
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }
}

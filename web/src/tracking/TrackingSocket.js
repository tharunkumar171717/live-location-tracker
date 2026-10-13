// Client for the /ws tracking protocol (see server/src/ws/protocol.js).
// Handles the auth handshake, token refresh, rejoining sessions after
// reconnects, exponential backoff, and an offline outbox: points recorded
// while disconnected are stored and sent as acked batches on reconnect.
//
// Two modes:
//   member: getToken() returns a Supabase access token; can join and send.
//   viewer: shareToken is a view-only link token; the server picks the session.
import { Outbox } from './outbox.js';

// Close codes after which a viewer's retry can't help.
const FATAL_CLOSE = new Set([4401, 4403]);

export class TrackingSocket {
  constructor({ url, getToken, shareToken, onMessage, onStatus, onOutbox, storage }) {
    this.url = url;
    this.getToken = getToken; // async () => access token | null
    this.shareToken = shareToken || null;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onOutbox = onOutbox || (() => {});
    this.storage = storage;
    this.sessions = new Set();
    this.outboxes = new Map(); // sessionId -> Outbox
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
    const box = this.outbox(sessionId);
    this.onOutbox(sessionId, box.size);
    if (this.ready) {
      this.send({ type: 'join', sessionId });
      this.flush(sessionId);
    }
  }

  leave(sessionId) {
    this.sessions.delete(sessionId);
    if (this.ready) this.send({ type: 'leave', sessionId });
  }

  // Live when connected; otherwise into the outbox for a later batch.
  sendLocation(sessionId, location) {
    const point = {
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy ?? null,
      heading: location.heading ?? null,
      speed: location.speed ?? null,
      timestamp: location.timestamp ?? Date.now(),
    };
    const box = this.outbox(sessionId);
    if (this.ready && box.size === 0) {
      this.send({ type: 'location', sessionId, ...point });
      return;
    }
    // Queue behind anything still waiting so points stay in order.
    box.push(point);
    this.onOutbox(sessionId, box.size);
    if (this.ready) this.flush(sessionId);
  }

  // Call when the auth library refreshes the access token.
  async reauth(token) {
    if (this.shareToken || this.ws?.readyState !== WebSocket.OPEN) return;
    const t = token || (await this.getToken());
    if (t) this.send({ type: 'auth', token: t });
  }

  // --- internals ---

  outbox(sessionId) {
    if (!this.outboxes.has(sessionId)) this.outboxes.set(sessionId, new Outbox(sessionId, this.storage));
    return this.outboxes.get(sessionId);
  }

  flush(sessionId) {
    const box = this.outbox(sessionId);
    const batch = box.nextBatch();
    if (batch) this.send({ type: 'location_batch', sessionId, ...batch });
  }

  setReady(ready, status) {
    this.ready = ready;
    this.onStatus(status);
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  async open() {
    this.setReady(false, this.attempt ? 'reconnecting' : 'connecting');
    const token = this.shareToken ? null : await this.getToken();
    if (this.closed) return;
    if (!this.shareToken && !token) {
      this.setReady(false, 'unauthenticated');
      return;
    }

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () =>
      ws.send(JSON.stringify(this.shareToken ? { type: 'auth_share', token: this.shareToken } : { type: 'auth', token }));

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'auth_ok' || msg.type === 'auth_share_ok') {
        const wasReady = this.ready;
        this.attempt = 0;
        this.setReady(true, 'connected');
        if (!wasReady && !this.shareToken) {
          for (const id of this.sessions) {
            this.send({ type: 'join', sessionId: id });
            this.flush(id);
          }
        }
      } else if (msg.type === 'auth_expired') {
        this.reauth();
      } else if (msg.type === 'batch_ack') {
        const box = this.outbox(msg.sessionId);
        if (box.ack(msg.ref)) {
          this.onOutbox(msg.sessionId, box.size);
          this.flush(msg.sessionId);
        }
      } else if (msg.type === 'error' && msg.ref && msg.sessionId) {
        // A rejected batch (e.g. session ended) would be retried forever.
        if (msg.code !== 'rate_limited' && msg.code !== 'internal') {
          this.outbox(msg.sessionId).clear();
          this.onOutbox(msg.sessionId, 0);
        } else {
          this.outbox(msg.sessionId).unsend();
        }
      }
      this.onMessage(msg);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const box of this.outboxes.values()) box.unsend();
      if (this.closed) return;
      // A member's token may just need refreshing, so members keep retrying;
      // an expired or revoked share link never comes back.
      if (this.shareToken && FATAL_CLOSE.has(event.code)) {
        this.closed = true;
        this.setReady(false, 'expired');
        return;
      }
      this.setReady(false, 'reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt) * (0.5 + Math.random() / 2);
      this.attempt += 1;
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }
}

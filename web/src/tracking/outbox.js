// Points recorded while offline, per session, kept in localStorage so they
// survive a reload. Sent as one batch after reconnecting; removed only once
// the server acks them, so a drop mid-send doesn't lose anything.
export const MAX_POINTS = 1000; // ~25 min at the moving rate; oldest dropped first
export const BATCH_SIZE = 200;

const key = (sessionId) => `llt:outbox:${sessionId}`;

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class Outbox {
  constructor(sessionId, storage = safeStorage()) {
    this.sessionId = sessionId;
    this.storage = storage;
    this.points = this.load();
    this.inFlight = null; // {ref, count}
  }

  load() {
    try {
      const raw = this.storage?.getItem(key(this.sessionId));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      if (this.points.length) this.storage?.setItem(key(this.sessionId), JSON.stringify(this.points));
      else this.storage?.removeItem(key(this.sessionId));
    } catch {
      // Storage full or blocked: keep the in-memory copy.
    }
  }

  get size() {
    return this.points.length;
  }

  push(point) {
    this.points.push(point);
    if (this.points.length > MAX_POINTS) {
      this.points.splice(0, this.points.length - MAX_POINTS);
      this.inFlight = null; // indexes shifted; resend from scratch
    }
    this.save();
  }

  // The next batch to send, or null if empty or a batch is awaiting its ack.
  nextBatch() {
    if (this.inFlight || this.points.length === 0) return null;
    const points = this.points.slice(0, BATCH_SIZE);
    const ref = `${this.sessionId.slice(0, 8)}-${Date.now()}-${points.length}`;
    this.inFlight = { ref, count: points.length };
    return { ref, points };
  }

  ack(ref) {
    if (this.inFlight?.ref !== ref) return false;
    this.points.splice(0, this.inFlight.count);
    this.inFlight = null;
    this.save();
    return true;
  }

  // Connection dropped before the ack: send the same points again later.
  unsend() {
    this.inFlight = null;
  }

  clear() {
    this.points = [];
    this.inFlight = null;
    this.save();
  }
}

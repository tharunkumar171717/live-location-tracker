// Location event bus. Producers publish accepted location updates; consumers
// (the WebSocket broadcaster today) subscribe. The in-process implementation
// keeps a single server simple; the optional Kafka layer replaces it later
// without touching producers or consumers.
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export const locationBus = {
  async publish(event) {
    emitter.emit('location', event);
  },
  subscribe(handler) {
    emitter.on('location', handler);
    return () => emitter.off('location', handler);
  },
};

// Prometheus metrics, served at GET /metrics. One registry per process.
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'llt_' });

// Hubs register a callback so the gauge reads live connection counts.
const socketCounters = new Set();

export const metrics = {
  wsConnections: new client.Gauge({
    name: 'llt_ws_connections',
    help: 'Open WebSocket connections',
    labelNames: ['kind'],
    registers: [registry],
    collect() {
      let users = 0;
      let viewers = 0;
      for (const count of socketCounters) {
        const c = count();
        users += c.users;
        viewers += c.viewers;
      }
      this.set({ kind: 'user' }, users);
      this.set({ kind: 'viewer' }, viewers);
    },
  }),
  wsMessages: new client.Counter({
    name: 'llt_ws_messages_total',
    help: 'WebSocket messages received, by type',
    labelNames: ['type'],
    registers: [registry],
  }),
  locations: new client.Counter({
    name: 'llt_locations_recorded_total',
    help: 'Location points stored',
    labelNames: ['source'],
    registers: [registry],
  }),
  rateLimited: new client.Counter({
    name: 'llt_rate_limited_total',
    help: 'Requests or messages rejected by rate limiting',
    labelNames: ['kind'],
    registers: [registry],
  }),
  geofenceEvents: new client.Counter({
    name: 'llt_geofence_events_total',
    help: 'Geofence enter/exit events',
    labelNames: ['kind'],
    registers: [registry],
  }),
  httpRequests: new client.Histogram({
    name: 'llt_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  }),
  retentionDeleted: new client.Counter({
    name: 'llt_retention_rows_deleted_total',
    help: 'location_history rows removed by the retention job',
    labelNames: ['reason'],
    registers: [registry],
  }),
};

export function trackSockets(countFn) {
  socketCounters.add(countFn);
  return () => socketCounters.delete(countFn);
}

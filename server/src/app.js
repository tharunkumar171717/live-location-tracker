// Builds one server instance: HTTP API, WebSocket hub, bus, demo simulator.
// index.js starts one; tests start several against the same database to
// prove events cross instances.
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';
import { metrics, registry } from './metrics.js';
import { createBus } from './bus.js';
import { createApi } from './routes/api.js';
import { createPublicApi } from './routes/public.js';
import { createHub } from './ws/hub.js';
import { createLocationRecorder } from './services/locations.js';
import { createGeofenceService } from './services/geofences.js';
import { createDemoService } from './demo/simulator.js';
import { scheduleRetention } from './jobs/retention.js';

export async function createServer({ redisUrl = config.redisUrl, jobs = true } = {}) {
  const bus = createBus({ redisUrl });
  await bus.ready();
  const geofences = createGeofenceService({ bus });
  const recorder = createLocationRecorder({ bus, geofences });
  const demo = createDemoService({ bus, recorder });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '64kb' }));

  // Access log + latency histogram. Route patterns, not raw URLs, keep
  // metric cardinality bounded (no session ids or tokens in labels).
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      metrics.httpRequests.observe({ method: req.method, route, status: res.statusCode }, seconds);
      if (!['/health', '/ready', '/metrics'].includes(req.path)) {
        logger.info({ method: req.method, route, status: res.statusCode, ms: Math.round(seconds * 1000) }, 'http');
      }
    });
    next();
  });

  // Liveness: the process is up. Readiness: it can reach its dependencies.
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/ready', async (req, res) => {
    const checks = {};
    try {
      await pool.query('select 1');
      checks.db = 'ok';
    } catch {
      checks.db = 'down';
    }
    try {
      checks.bus = (await bus.ping()) ? `ok (${bus.kind})` : 'down';
    } catch {
      checks.bus = 'down';
    }
    const ok = Object.values(checks).every((v) => v.startsWith('ok'));
    res.status(ok ? 200 : 503).json({ ok, checks });
  });

  app.get('/metrics', async (req, res) => {
    if (config.metricsToken && req.headers.authorization !== `Bearer ${config.metricsToken}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  const api = createApi({ bus, recorder, geofences, demo });
  const publicApi = createPublicApi({ geofences, demo });
  app.use('/api', api);
  app.use('/public', publicApi);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Express 5 forwards rejected promises from async handlers here.
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) logger.error({ err, path: req.path }, 'request failed');
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  const server = http.createServer(app);
  const hub = createHub({ server, bus, recorder, demo });
  await demo.boot();
  const stopRetention = jobs ? scheduleRetention() : () => {};

  return {
    app,
    server,
    bus,
    hub,
    demo,
    listen(port = config.port) {
      return new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
    },
    async close() {
      stopRetention();
      demo.close();
      recorder.close();
      geofences.close();
      api.close();
      publicApi.close();
      await hub.close();
      await new Promise((resolve) => server.close(resolve));
      await bus.close();
    },
  };
}

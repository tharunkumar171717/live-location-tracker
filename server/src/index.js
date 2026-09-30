import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { api } from './routes/api.js';
import { attachWebSocketServer } from './ws/hub.js';

const app = express();
app.disable('x-powered-by');
// Mobile apps send no Origin header, so they're unaffected by CORS.
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '32kb' }));

app.get('/health', async (req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api', api);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Express 5 forwards rejected promises from async handlers here.
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[http]', err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(config.port, () => {
  console.log(`API on http://localhost:${config.port}  WebSocket on ws://localhost:${config.port}/ws`);
});

function shutdown() {
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

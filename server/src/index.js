import { config } from './config.js';
import { pool } from './db.js';
import { logger } from './logger.js';
import { createServer } from './app.js';

const instance = await createServer();
const port = await instance.listen(config.port);
logger.info(
  { port, bus: instance.bus.kind, demo: config.demo.enabled },
  `API on http://localhost:${port}  WebSocket on ws://localhost:${port}/ws`,
);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), 5000).unref();
  await instance.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

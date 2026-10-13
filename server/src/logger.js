// Structured JSON logs (one line per event) so Railway / any log shipper can
// filter on fields. `npm run dev` pipes them through pino-pretty.
import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'llt-server' },
  redact: ['token', '*.token', 'req.headers.authorization'],
});

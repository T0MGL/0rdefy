// Sentry must initialize before any other module loads.
// Side-effect import: importado primero en sifen-worker.ts.
// dotenv se carga aca por la misma razon que en api/instrument.ts: los
// ESM imports se ejecutan antes que el modulo top-level que cargaria
// process.env.

import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

dotenv.config();

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    serverName: 'sifen-worker',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
  });
}

// Sentry must initialize before any other module loads.
// This file is imported first in index.ts (side-effect import).
// dotenv is loaded here because ESM imports execute before module-level code,
// so process.env.SENTRY_DSN would be undefined if we relied on the main dotenv.config() call.

import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

dotenv.config();

const dsn = process.env.SENTRY_DSN;

if (dsn) {
    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
        sendDefaultPii: true,
    });
}

/**
 * SIFEN async worker entrypoint.
 *
 * Proceso separado del web server. Corre dispatcher + poller en el mismo
 * proceso Node para arrancar (1 servicio Railway). Cuando el volumen lo
 * justifique se pueden separar usando la env var SIFEN_WORKER_ROLE.
 *
 * Lifecycle:
 *   1. Sentry init (side-effect import)
 *   2. Resolver Postgres connection string para el listener
 *   3. Levantar SifenPgListener (se conecta + LISTEN)
 *   4. Levantar dispatcher y/o poller segun SIFEN_WORKER_ROLE
 *   5. Esperar SIGTERM/SIGINT: graceful shutdown con AbortController y
 *      timeout de 15s antes de exit hard
 *
 * Modos (SIFEN_WORKER_ROLE):
 *   - 'all' (default): dispatcher + poller en mismo proceso
 *   - 'dispatcher': solo dispatcher
 *   - 'poller': solo poller
 */

import './instrument-worker';

import { logger } from '../utils/logger';
import { SifenDispatcher } from './sifen-dispatcher';
import { SifenPoller } from './sifen-poller';
import {
  SifenPgListener,
  resolveListenerConnectionString,
} from './shared/pg-listener';

type WorkerRole = 'all' | 'dispatcher' | 'poller';

const SHUTDOWN_TIMEOUT_MS = 15_000;

function resolveRole(): WorkerRole {
  const raw = (process.env.SIFEN_WORKER_ROLE || 'all').toLowerCase();
  if (raw === 'dispatcher' || raw === 'poller' || raw === 'all') return raw;
  logger.warn(`[sifen-worker] unknown SIFEN_WORKER_ROLE='${raw}', defaulting to 'all'`);
  return 'all';
}

async function main(): Promise<void> {
  const role = resolveRole();
  logger.info(`[sifen-worker] starting role=${role} node=${process.version} pid=${process.pid}`);

  const listener = new SifenPgListener(resolveListenerConnectionString());
  await listener.start();

  const components: Array<{ stop: () => Promise<void> }> = [];

  if (role === 'dispatcher' || role === 'all') {
    const dispatcher = new SifenDispatcher(listener);
    await dispatcher.start();
    components.push(dispatcher);
  }
  if (role === 'poller' || role === 'all') {
    const poller = new SifenPoller(listener);
    await poller.start();
    components.push(poller);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[sifen-worker] received ${signal}, draining...`);

    // Hard exit si shutdown no termina en SHUTDOWN_TIMEOUT_MS.
    const hardTimer = setTimeout(() => {
      logger.error('[sifen-worker] graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    hardTimer.unref();

    try {
      await Promise.allSettled(components.map((c) => c.stop()));
      await listener.stop();
      clearTimeout(hardTimer);
      logger.info('[sifen-worker] shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error(
        `[sifen-worker] shutdown error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Unhandled rejections en un worker tienen que reportarse pero no
  // matar el proceso silenciosamente. Sentry los captura via init.
  process.on('unhandledRejection', (reason) => {
    logger.error(
      `[sifen-worker] unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`,
    );
  });
  process.on('uncaughtException', (err) => {
    logger.error(`[sifen-worker] uncaughtException: ${err.stack || err.message}`);
    // Estado del proceso ya no es confiable. Salir y dejar que Railway
    // reinicie. SIGTERM no se dispara por uncaught, asi que llamamos
    // shutdown explicito.
    void shutdown('uncaughtException');
  });

  logger.info(`[sifen-worker] ready (role=${role})`);
}

main().catch((err) => {
  logger.error(
    `[sifen-worker] fatal init error: ${err instanceof Error ? err.stack : String(err)}`,
  );
  process.exit(1);
});

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

// Plain console.log here is intentional: we need visibility BEFORE any
// other module imports run, since `logger` (and the modules it imports)
// can swallow stdout in weird ways under tsx/Railway combos.
console.log('[sifen-worker] boot: process started, pid=' + process.pid);

import './instrument-worker';
console.log('[sifen-worker] boot: instrument-worker loaded');

import { logger } from '../utils/logger';
console.log('[sifen-worker] boot: logger loaded');

import { SifenDispatcher } from './sifen-dispatcher';
console.log('[sifen-worker] boot: dispatcher loaded');

import { SifenPoller } from './sifen-poller';
console.log('[sifen-worker] boot: poller loaded');

import { SifenRealtimeListener } from './shared/realtime-listener';
console.log('[sifen-worker] boot: realtime-listener loaded');

type WorkerRole = 'all' | 'dispatcher' | 'poller';

const SHUTDOWN_TIMEOUT_MS = 15_000;

function resolveRole(): WorkerRole {
  const raw = (process.env.SIFEN_WORKER_ROLE || 'all').toLowerCase();
  if (raw === 'dispatcher' || raw === 'poller' || raw === 'all') return raw;
  logger.warn(`[sifen-worker] unknown SIFEN_WORKER_ROLE='${raw}', defaulting to 'all'`);
  return 'all';
}

async function main(): Promise<void> {
  console.log('[sifen-worker] main() entered');
  const role = resolveRole();
  console.log('[sifen-worker] role resolved: ' + role);
  logger.info(`[sifen-worker] starting role=${role} node=${process.version} pid=${process.pid}`);

  console.log('[sifen-worker] instantiating listener');
  const listener = new SifenRealtimeListener();
  console.log('[sifen-worker] listener.start() about to await');
  await listener.start();
  console.log('[sifen-worker] listener.start() returned');

  // Boot self-probe (temporal, gated por env): hace una consulta CHICA a SIFEN
  // desde el proceso worker para aislar si la ruta de red worker->SET funciona,
  // sin emitir ningun documento. Se quita despues del diagnostico.
  if (process.env.SIFEN_BOOT_PROBE === '1') {
    try {
      const { supabaseAdmin } = await import('../db/connection');
      const { decrypt } = await import('../services/sifen/encryption');
      const { consultLote } = await import('../services/sifen/sifen-client');
      const identityId = process.env.SIFEN_BOOT_PROBE_IDENTITY || '';
      const { data: fi } = await supabaseAdmin
        .from('fiscal_identities')
        .select('cert_pem, encrypted_private_key, sifen_environment')
        .eq('id', identityId)
        .single();
      if (!fi) {
        console.log('[sifen-worker][probe] no identity for probe');
      } else {
        const mtls = { certPem: fi.cert_pem as string, privateKeyPem: decrypt(fi.encrypted_private_key as string) };
        const env = (fi.sifen_environment === 'prod' ? 'prod' : 'test') as 'test' | 'prod';
        const t0 = Date.now();
        try {
          const r = await consultLote('999999999999999', env, mtls);
          console.log(`[sifen-worker][probe] OK in ${Date.now() - t0}ms env=${env} state=${r.state} code=${r.responseCode}`);
        } catch (e) {
          console.log(`[sifen-worker][probe] FAIL in ${Date.now() - t0}ms err=${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      console.log(`[sifen-worker][probe] setup error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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

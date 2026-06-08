/**
 * sifen-drain.ts
 *
 * TRIGGER MANUAL de envio a SIFEN. Drena la cola de facturas en estado
 * 'queued' UNA sola vez y sale. Es el unico camino de emision cuando el
 * auto-dispatch del worker esta apagado (SIFEN_AUTO_DISPATCH!=true).
 *
 * Contexto (incidente fiscal 2026-06): el egress de Railway no alcanza a SET,
 * los envios automaticos dan timeout. El owner pidio que NADA se reintente
 * solo. El dispatcher worker arranca en modo manual-only (sin NOTIFY, sin
 * sweep, sin barrido de arranque). Para empujar el backlog cuando el egress
 * este arreglado, un humano corre ESTE script una vez:
 *
 *   railway run --service <worker> npx tsx api/scripts/sifen-drain.ts
 *
 * Comportamiento:
 *   - Toma las invoices con sifen_status='queued' y dispatch_key NULL.
 *   - Las agrupa por (identity, tipo, env) y envia cada lote a SIFEN.
 *   - Las que se aceptan pasan a 'sent' (el poller las consulta despues).
 *   - Las que SIFEN rechaza pasan a 'rejected'.
 *   - Las que fallan por timeout/red vuelven a 'queued' (se pueden re-drenar
 *     manualmente; NO hay reintento automatico).
 *   - Una sola pasada. No hace loop, no abre listeners, no toca timers.
 *
 * NO releasa orphan-claims ni re-encola facturas por su cuenta. Si una factura
 * quedo con un dispatch_key colgado (claim zombie de un crash), este script NO
 * la toca: se limpia aparte, a mano.
 *
 * Requiere el mismo entorno que el worker (SUPABASE_*, SIFEN_ENCRYPTION_KEY).
 */

import 'dotenv/config';
import { SifenDispatcher } from '../workers/sifen-dispatcher';
import { SifenRealtimeListener } from '../workers/shared/realtime-listener';
import { logger } from '../utils/logger';

async function main(): Promise<void> {
  if (!process.env.SIFEN_ENCRYPTION_KEY) {
    console.error(
      '[sifen-drain] Falta SIFEN_ENCRYPTION_KEY. Corre con: railway run --service <worker> npx tsx api/scripts/sifen-drain.ts',
    );
    process.exit(1);
  }

  // Listener sin .start(): drainOnce no usa NOTIFY, solo lo necesita para
  // construir el dispatcher. No se abre ninguna conexion realtime.
  const listener = new SifenRealtimeListener();
  const dispatcher = new SifenDispatcher(listener);

  logger.info('[sifen-drain] manual emission trigger: draining queued invoices once');
  await dispatcher.drainOnce();
  logger.info('[sifen-drain] done. Revisa el estado de las facturas en el dashboard.');

  // drainOnce no abrio timers ni sockets persistentes; salimos limpio.
  process.exit(0);
}

main().catch((err) => {
  logger.error(
    `[sifen-drain] fatal: ${err instanceof Error ? err.stack : String(err)}`,
  );
  process.exit(1);
});

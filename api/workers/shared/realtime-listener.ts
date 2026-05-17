/**
 * Supabase Realtime listener para wake-up del worker SIFEN.
 *
 * Reemplaza el pg LISTEN/NOTIFY directo (que requiere conexion TCP a
 * db.<ref>.supabase.co, IPv6-only desde 2024 y bloqueada en Railway).
 * Usa supabase-js `.channel().on('postgres_changes', ...)` que va por
 * WSS sobre IPv4 nativo.
 *
 * Mapping de "canales" logicos a postgres_changes:
 *   - sifen_invoice_queued -> INSERT/UPDATE en invoices con sifen_status='queued'
 *   - sifen_lote_pending   -> UPDATE en invoices con sifen_status='sent' + protocol set
 *
 * Los triggers pg_notify de migration 189 siguen ahi; no rompen nada y
 * vuelven a funcionar si en el futuro habilitamos el IPv4 add-on de
 * Supabase.
 *
 * El listener intencionalmente no expone el payload de la row al handler:
 * dispatcher y poller solo llaman scheduleWake() y despues hacen su
 * propia query con FOR UPDATE / SKIP LOCKED. Esto evita race conditions
 * donde el wake-up dispara antes de que la fila este visible al worker
 * por replicacion lag.
 *
 * Pre-req: tabla `invoices` en publication `supabase_realtime`
 * (garantizado por migration 190).
 */

import { type RealtimeChannel } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../db/connection';
import { logger } from '../../utils/logger';

export type SifenChannel = 'sifen_invoice_queued' | 'sifen_lote_pending';
export type SifenListener = () => void | Promise<void>;

export class SifenRealtimeListener {
  private readonly handlers = new Map<SifenChannel, SifenListener[]>();
  private channels: RealtimeChannel[] = [];
  private started = false;
  private stopped = false;

  on(channel: SifenChannel, handler: SifenListener): void {
    const arr = this.handlers.get(channel) ?? [];
    arr.push(handler);
    this.handlers.set(channel, arr);
  }

  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error('SifenRealtimeListener stopped; create a new instance');
    }
    if (this.started) return;
    this.started = true;

    // Canal 1: invoices encoladas (dispatcher wake-up).
    // Capturamos tanto INSERT (emision nueva async) como UPDATE
    // (retryInvoice vuelve a 'queued' una invoice rejected).
    const queuedChannel = supabaseAdmin
      .channel('sifen-invoice-queued-watch')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'invoices',
          filter: 'sifen_status=eq.queued',
        },
        () => this.dispatch('sifen_invoice_queued'),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'invoices',
          filter: 'sifen_status=eq.queued',
        },
        () => this.dispatch('sifen_invoice_queued'),
      )
      .subscribe((status) => {
        logger.info(`[SifenRealtimeListener] queued channel status=${status}`);
      });

    // Canal 2: lotes enviados a SIFEN, listos para consulta (poller wake-up).
    const sentChannel = supabaseAdmin
      .channel('sifen-lote-pending-watch')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'invoices',
          filter: 'sifen_status=eq.sent',
        },
        () => this.dispatch('sifen_lote_pending'),
      )
      .subscribe((status) => {
        logger.info(`[SifenRealtimeListener] sent channel status=${status}`);
      });

    this.channels = [queuedChannel, sentChannel];
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const toRemove = this.channels;
    this.channels = [];
    await Promise.allSettled(
      toRemove.map((ch) => supabaseAdmin.removeChannel(ch)),
    );
    logger.info('[SifenRealtimeListener] stopped');
  }

  private dispatch(channel: SifenChannel): void {
    const handlers = this.handlers.get(channel) ?? [];
    for (const handler of handlers) {
      try {
        const result = handler();
        if (result instanceof Promise) {
          result.catch((err) => {
            logger.error(
              `[SifenRealtimeListener] handler for ${channel} threw: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      } catch (err) {
        logger.error(
          `[SifenRealtimeListener] sync handler for ${channel} threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

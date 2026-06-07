/**
 * Carrier push retry worker.
 *
 * Sweeps shipments stuck at carrier_push_status='failed' whose backoff window
 * has elapsed (carrier_push_next_attempt_at <= now) and re-runs the push. The
 * push service is idempotent (advisory lock + existing-external-id +
 * findExistingByReference), so a retry never double-dispatches.
 *
 * Wake-up follows the SIFEN pattern: a fallback setInterval sweep, optionally
 * nudged by a Supabase Realtime subscription on failed shipments. Direct pg
 * LISTEN/NOTIFY is not used because the Supabase pg host is IPv6-only and
 * blocked from Railway (same constraint that drove SifenRealtimeListener).
 *
 * Runs inside the worker process (see sifen-worker entrypoint), not the web
 * server.
 */

import { type RealtimeChannel } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';
import { pushOrderToCarrier } from '../services/carriers/carrier-push.service';
import { getCarrier } from '../services/carriers/registry';

const log = logger.child('CarrierPushRetry');

const FALLBACK_SWEEP_MS = 60_000;
const WAKE_COALESCE_MS = 2_000;
const SWEEP_LIMIT = 100;
const MAX_ATTEMPTS = 8;

interface FailedRow {
  store_id: string;
  order_id: string;
  carrier_provider: string | null;
  carrier_push_attempts: number | null;
}

export class CarrierPushRetryWorker {
  private channel: RealtimeChannel | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private cycleInFlight: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.stopped) throw new Error('CarrierPushRetryWorker stopped; create a new instance');
    if (this.running) return;
    this.running = true;

    this.channel = supabaseAdmin
      .channel('carrier-push-failed-watch')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shipments',
          filter: 'carrier_push_status=eq.failed',
        },
        () => this.scheduleWake(),
      )
      .subscribe((status) => {
        log.info(`realtime channel status=${status}`);
      });

    this.sweepTimer = setInterval(() => this.scheduleWake(), FALLBACK_SWEEP_MS);
    this.sweepTimer.unref();

    this.scheduleWake();
    log.info('started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.wakeTimer = null;
    this.sweepTimer = null;

    if (this.channel) {
      await supabaseAdmin.removeChannel(this.channel).catch(() => undefined);
      this.channel = null;
    }

    if (this.cycleInFlight) {
      await this.cycleInFlight.catch(() => undefined);
    }
    log.info('stopped');
  }

  private scheduleWake(): void {
    if (!this.running || this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.runCycle();
    }, WAKE_COALESCE_MS);
    this.wakeTimer.unref();
  }

  private runCycle(): void {
    if (!this.running || this.cycleInFlight) return;
    this.cycleInFlight = this.sweep()
      .catch((err) => {
        log.error('cycle failed', { error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        this.cycleInFlight = null;
      });
  }

  private async sweep(): Promise<void> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('shipments')
      .select('store_id, order_id, carrier_provider, carrier_push_attempts')
      .eq('carrier_push_status', 'failed')
      .is('carrier_external_id', null)
      .lt('carrier_push_attempts', MAX_ATTEMPTS)
      .or(`carrier_push_next_attempt_at.is.null,carrier_push_next_attempt_at.lte.${nowIso}`)
      .order('carrier_push_next_attempt_at', { ascending: true, nullsFirst: true })
      .limit(SWEEP_LIMIT);

    if (error) {
      log.error('sweep query failed', { error: error.message });
      return;
    }
    if (!data || data.length === 0) return;

    for (const row of data as FailedRow[]) {
      if (!this.running) return;
      const provider = row.carrier_provider;
      if (!provider || !getCarrier(provider)) continue;

      // pushOrderToCarrier re-resolves the integration and re-claims the order;
      // it filters by trigger_status internally. We pass that trigger status so
      // the retry passes the gate, by reading the store's configured status.
      const triggerStatus = await this.resolveTriggerStatus(row.store_id, provider);
      if (!triggerStatus) continue;

      await pushOrderToCarrier(row.store_id, row.order_id, triggerStatus);
    }

    log.info('sweep processed', { count: data.length });
  }

  private async resolveTriggerStatus(storeId: string, provider: string): Promise<string | null> {
    const { data, error } = await supabaseAdmin
      .from('shipping_integrations')
      .select('trigger_status, is_active, auto_push')
      .eq('store_id', storeId)
      .eq('provider', provider)
      .maybeSingle();

    if (error || !data || !data.is_active || !data.auto_push) return null;
    return data.trigger_status ?? 'ready_to_ship';
  }
}

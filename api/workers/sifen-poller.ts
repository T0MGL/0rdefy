/**
 * SIFEN async poller.
 *
 * Consume invoices con sifen_status='sent' + sifen_protocol_number poblado,
 * y consulta el resultado del lote a SIFEN via siResultLoteDE (Manual v150
 * 9.3). Despacha el estado individual de cada DE a la tabla `invoices` y
 * notifica al owner via `owner_alerts`.
 *
 * Wake-up:
 *   - LISTEN sifen_lote_pending (NOTIFY desde trigger de migration 189
 *     cuando el dispatcher marca un lote como 'sent')
 *   - setInterval cada FALLBACK_SWEEP_MS por si el NOTIFY se perdio
 *
 * Polling cadence:
 *   - dispatcher programa next_poll_at = NOW() + dTpoProces*2 (60s min)
 *   - poller toma todas las rows con next_poll_at <= NOW()
 *   - si SIFEN dice "todavia procesando" (0361): backoff exponencial
 *     (5, 10, 20, 40 minutos, cap 60min)
 *   - si SIFEN dice "procesado" (0362): UPDATE por CDC, owner_alert
 *   - si SIFEN dice "lote inexistente" (0360): marca rejected
 *
 * Cap de attempts: si despues de POLL_MAX_ATTEMPTS un lote sigue
 * processing, emite owner_alert critico y deja la invoice en 'sent'
 * para que el owner la investigue manualmente.
 */

import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';
import {
  consultLote,
  consultDEResult,
  type SifenLoteResultResponse,
  type SifenConsultaDEResult,
  type SifenMtls,
} from '../services/sifen/sifen-client';
import {
  loadCertificateMaterial,
  emitOwnerAlert,
  logInvoiceEvent,
  dispatchApprovedInvoiceEmail,
} from '../services/invoicing.service';
import { SifenKeyCache, type SifenKeyMaterial } from './shared/key-cache';
import { SifenRealtimeListener } from './shared/realtime-listener';

const FALLBACK_SWEEP_MS = 60_000;
const WAKE_COALESCE_MS = 1_000;

/**
 * Limite de protocols a consultar en un ciclo. Cada consulta es 1
 * request mTLS, asi que con 100 protocols un ciclo toma ~10s. Para
 * mil tiendas con ~200 lotes/dia el limite no se acerca.
 */
const SWEEP_LIMIT = 100;

/**
 * Max polling attempts antes de marcar el lote como stuck y emitir
 * critical alert. Con backoff cap de 60min, 24 attempts = ~24hs
 * cubriendo todo un dia habil + margen.
 */
const POLL_MAX_ATTEMPTS = 24;

/**
 * Timeout del consultLote (siResultLoteDE). SET puede mantener la conexion
 * abierta mientras el lote sigue procesando, asi que un valor agresivo aca
 * dispara el abort antes de que llegue la respuesta. Lo subimos al limite
 * del cliente HTTP (90s) y dejamos que el fallback consultDE-por-CDC resuelva
 * la aprobacion cuando esto se agote. NO bajar de TIMEOUT_MS del cliente o el
 * consultLote nunca llega a devolver y todo termina en "request aborted".
 */
const POLL_TIMEOUT_MS = 90_000;

/**
 * Timeout del fallback consultDE por CDC. La consulta individual contesta
 * en ~1s desde una IP que alcanza a SET; 20s cubre cold-start del socket mTLS
 * con margen sin colgar el ciclo del poller.
 */
const CONSULT_DE_TIMEOUT_MS = 20_000;

const KEY_CACHE_OPTIONS = { max: 100, ttlMs: 5 * 60 * 1_000 };

interface PendingProtocol {
  protocolNumber: string;
  identityId: string;
  env: 'test' | 'prod';
  invoiceIds: string[];
  storeIds: string[];
  attempts: number;
}

export class SifenPoller {
  private readonly keyCache = new SifenKeyCache(KEY_CACHE_OPTIONS);
  private readonly abortController = new AbortController();

  private wakeTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private cycleInFlight: Promise<void> | null = null;

  constructor(private readonly listener: SifenRealtimeListener) {}

  async start(): Promise<void> {
    if (this.stopped) throw new Error('Poller stopped, create a new instance');
    if (this.running) return;
    this.running = true;

    this.listener.on('sifen_lote_pending', () => {
      // Si SIFEN procesa rapido (sub-minuto), igual respetamos el
      // next_poll_at del dispatcher; no consultamos antes de tiempo.
      // El NOTIFY solo nos asegura que cuando llegue ese momento el
      // poller esta despierto.
      this.scheduleWake();
    });

    this.sweepTimer = setInterval(() => this.scheduleWake(), FALLBACK_SWEEP_MS);
    this.sweepTimer.unref();

    this.scheduleWake();

    logger.info('[SifenPoller] started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.wakeTimer = null;
    this.sweepTimer = null;

    this.abortController.abort();

    if (this.cycleInFlight) {
      try {
        await this.cycleInFlight;
      } catch {
        /* swallow */
      }
    }

    this.keyCache.clear();
    logger.info('[SifenPoller] stopped');
  }

  private scheduleWake(): void {
    if (!this.running) return;
    if (this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.runCycle();
    }, WAKE_COALESCE_MS);
    this.wakeTimer.unref();
  }

  private runCycle(): void {
    if (!this.running) return;
    if (this.cycleInFlight) return;
    this.cycleInFlight = this.processPending()
      .catch((err) => {
        logger.error(
          `[SifenPoller] cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        this.cycleInFlight = null;
      });
  }

  private async processPending(): Promise<void> {
    const protocols = await this.fetchPendingProtocols();
    if (protocols.length === 0) return;

    for (const proto of protocols) {
      if (!this.running) return;
      await this.processProtocol(proto);
    }
  }

  private async fetchPendingProtocols(): Promise<PendingProtocol[]> {
    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select(
        'id, store_id, identity_id, sifen_protocol_number, sifen_lote_poll_attempts, fiscal_identities!inner(sifen_environment)',
      )
      .eq('sifen_status', 'sent')
      .not('sifen_protocol_number', 'is', null)
      .lte('sifen_lote_next_poll_at', nowIso)
      .order('sifen_lote_next_poll_at', { ascending: true })
      .limit(SWEEP_LIMIT * 50);

    if (error) {
      logger.error(`[SifenPoller] fetch pending failed: ${error.message}`);
      return [];
    }
    if (!data || data.length === 0) return [];

    // Agrupar por protocol number. Multiples invoices con el mismo
    // protocol vienen del mismo lote.
    // supabase-js typea el embedded join como array aunque sea 1-to-1.
    type PendingRow = {
      id: string;
      store_id: string;
      identity_id: string | null;
      sifen_protocol_number: string | null;
      sifen_lote_poll_attempts: number | null;
      fiscal_identities: { sifen_environment: string } | Array<{ sifen_environment: string }> | null;
    };
    const grouped = new Map<string, PendingProtocol>();
    for (const r of data as unknown as PendingRow[]) {
      const fi = Array.isArray(r.fiscal_identities)
        ? r.fiscal_identities[0]
        : r.fiscal_identities;
      const env = fi?.sifen_environment;
      if (env !== 'test' && env !== 'prod') continue;
      if (!r.identity_id || !r.sifen_protocol_number) continue;

      const key = r.sifen_protocol_number;
      let bucket = grouped.get(key);
      if (!bucket) {
        bucket = {
          protocolNumber: r.sifen_protocol_number,
          identityId: r.identity_id,
          env,
          invoiceIds: [],
          storeIds: [],
          attempts: r.sifen_lote_poll_attempts ?? 0,
        };
        grouped.set(key, bucket);
      }
      bucket.invoiceIds.push(r.id);
      bucket.storeIds.push(r.store_id);
      if ((r.sifen_lote_poll_attempts ?? 0) > bucket.attempts) {
        bucket.attempts = r.sifen_lote_poll_attempts ?? 0;
      }
    }

    return Array.from(grouped.values()).slice(0, SWEEP_LIMIT);
  }

  private async processProtocol(proto: PendingProtocol): Promise<void> {
    const material = await this.getKeyMaterial(proto.identityId);
    if (!material) {
      logger.warn(
        `[SifenPoller] no cert material for identity=${proto.identityId} protocol=${proto.protocolNumber}`,
      );
      await this.scheduleRetry(proto, 'Cert load failed');
      return;
    }
    const mtls: SifenMtls = {
      certPem: material.certPem,
      privateKeyPem: material.privateKeyPem,
    };

    const cycleAbort = new AbortController();
    const timeout = setTimeout(() => cycleAbort.abort(), POLL_TIMEOUT_MS);
    timeout.unref();
    const onParentAbort = () => cycleAbort.abort();
    this.abortController.signal.addEventListener('abort', onParentAbort, { once: true });

    let result: SifenLoteResultResponse | null = null;
    let loteError: string | null = null;
    try {
      result = await consultLote(
        proto.protocolNumber,
        proto.env,
        mtls,
        cycleAbort.signal,
      );
    } catch (err) {
      loteError = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[SifenPoller] consultLote transient failure protocol=${proto.protocolNumber}: ${loteError}`,
      );
    } finally {
      clearTimeout(timeout);
      this.abortController.signal.removeEventListener('abort', onParentAbort);
    }

    // consultLote concluyente: aplicar el resultado del lote tal cual.
    if (result && result.state === 'processed') {
      await this.applyProcessedResult(proto, result);
      return;
    }
    if (result && result.state === 'not_found') {
      // SIFEN dice que el protocolo no existe. Antes de marcar rejected,
      // consultamos por CDC: si el DE ya quedo aprobado en SET, el "lote
      // inexistente" es solo que el lote expiro de su lado pero el documento
      // existe. El fallback resuelve la aprobacion; si tampoco lo encuentra,
      // recien ahi marcamos rejected.
      const resolved = await this.resolveViaConsultDE(proto, mtls);
      if (resolved) return;
      await this.markProtocolRejected(
        proto,
        result.responseCode,
        result.responseMessage || 'Lote inexistente en SIFEN',
      );
      return;
    }

    // Lote en 'processing' LIMPIO (0361): SET acepto la consulta y dice que el
    // lote sigue procesando. Esto NO es ambiguo: reprogramamos con backoff y
    // NO disparamos el fallback. Un consultDE por CDC aca no aportaria (el DE
    // todavia no tiene estado final) y martillaria a SET con N requests por
    // poll. Dejamos que el proximo ciclo reintente consultLote.
    if (result && result.state === 'processing') {
      await this.scheduleRetry(proto, 'SIFEN processing');
      return;
    }

    // Lote INCONCLUSO por falla de transporte: consultLote colgo/abort
    // (loteError) o devolvio un codigo desconocido. SET puede mantener abierta
    // la conexion de siResultLoteDE mientras procesa, agotando el timeout sin
    // contestar. La consulta DE por CDC contesta en ~1s y resuelve el estado
    // real de forma confiable, asi que SOLO aca la usamos como fallback ANTES
    // de reprogramar. Asi un lote cuyo consultLote cuelga se resuelve a
    // 'approved' sin quedar atascado, sin hammerear a SET en los 'processing'
    // legitimos.
    const resolved = await this.resolveViaConsultDE(proto, mtls);
    if (resolved) return;

    if (loteError) {
      await this.scheduleRetry(proto, loteError);
      return;
    }
    // Codigo desconocido: log y reintenta (sin entrar en loop infinito; el
    // cap de attempts corta).
    logger.warn(
      `[SifenPoller] unknown state protocol=${proto.protocolNumber} code=${result?.responseCode ?? 'n/a'}`,
    );
    await this.scheduleRetry(
      proto,
      `Unknown SIFEN code ${result?.responseCode ?? 'n/a'}`,
    );
  }

  /**
   * Fallback de resolucion por CDC. Para cada invoice del lote que todavia
   * tiene CDC y sigue en 'sent', consulta el DE individual a SET (consultDE).
   * Si SET lo reporta aprobado (dCodRes 0422 / dEstRes "Aprobado"), aplica la
   * aprobacion (status, owner_alert, email). Esto desatasca lotes cuyo
   * consultLote cuelga o quedo inconcluso, porque la consulta por CDC SI
   * responde de forma confiable.
   *
   * Devuelve true si resolvio (aprobo) al menos una invoice; false si ninguna
   * pudo confirmarse aprobada (el caller reprograma con backoff).
   */
  private async resolveViaConsultDE(
    proto: PendingProtocol,
    mtls: SifenMtls,
  ): Promise<boolean> {
    const { data: invoiceRows, error: loadErr } = await supabaseAdmin
      .from('invoices')
      .select('id, cdc, store_id, document_number, order_id, sifen_status')
      .in('id', proto.invoiceIds);

    if (loadErr) {
      logger.error(
        `[SifenPoller] consultDE fallback: load invoices failed protocol=${proto.protocolNumber}: ${loadErr.message}`,
      );
      return false;
    }

    type InvoiceRow = {
      id: string;
      cdc: string | null;
      store_id: string;
      document_number: number;
      order_id: string | null;
      sifen_status: string;
    };

    let resolvedAny = false;
    const nowIso = new Date().toISOString();

    for (const inv of (invoiceRows ?? []) as InvoiceRow[]) {
      if (!this.running) break;
      // Ya resuelta por otra via: no la tocamos.
      if (inv.sifen_status !== 'sent') continue;
      if (!inv.cdc) continue;

      const cycleAbort = new AbortController();
      const timeout = setTimeout(() => cycleAbort.abort(), CONSULT_DE_TIMEOUT_MS);
      timeout.unref();
      const onParentAbort = () => cycleAbort.abort();
      this.abortController.signal.addEventListener('abort', onParentAbort, {
        once: true,
      });

      let deResult: SifenConsultaDEResult;
      try {
        deResult = await consultDEResult(inv.cdc, proto.env, mtls, cycleAbort.signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[SifenPoller] consultDE fallback transient failure cdc=${inv.cdc} protocol=${proto.protocolNumber}: ${message}`,
        );
        continue;
      } finally {
        clearTimeout(timeout);
        this.abortController.signal.removeEventListener('abort', onParentAbort);
      }

      if (!deResult.approved) {
        // No aprobado todavia (o no hallado): dejamos que el caller reprograme.
        logger.info(
          `[SifenPoller] consultDE fallback inconclusive cdc=${inv.cdc} code=${deResult.responseCode} estado=${deResult.estado ?? 'n/a'}`,
        );
        continue;
      }

      const { error: updErr } = await supabaseAdmin
        .from('invoices')
        .update({
          sifen_status: 'approved',
          sifen_response_code: deResult.responseCode,
          sifen_response_message: deResult.responseMessage,
          sifen_lote_last_error: null,
          sifen_lote_next_poll_at: null,
          approved_at: nowIso,
        })
        .eq('id', inv.id)
        .eq('sifen_status', 'sent'); // guard: no pisar otra transicion concurrente

      if (updErr) {
        logger.error(
          `[SifenPoller] consultDE fallback update failed invoice=${inv.id}: ${updErr.message}`,
        );
        continue;
      }

      resolvedAny = true;
      logger.info(
        `[SifenPoller] approved via consultDE fallback invoice=${inv.id} cdc=${inv.cdc} protocol=${proto.protocolNumber}`,
      );

      await logInvoiceEvent(inv.store_id, inv.id, 'approved', {
        async: true,
        via: 'consultDE_fallback',
        protocol_number: proto.protocolNumber,
        cdc: inv.cdc,
        response_code: deResult.responseCode,
        response_message: deResult.responseMessage,
      });

      await emitOwnerAlert({
        storeId: inv.store_id,
        alertType: 'invoice_approved_async',
        severity: 'low',
        title: 'Factura aprobada por SIFEN',
        message: `La factura ${inv.document_number} fue aprobada por SIFEN. CDC ${inv.cdc}.`,
        invoiceId: inv.id,
        orderId: inv.order_id,
        metadata: {
          protocol_number: proto.protocolNumber,
          cdc: inv.cdc,
          via: 'consultDE_fallback',
        },
      });

      // Email al cliente (PDF + QR). Fire-and-forget, nunca throws.
      void dispatchApprovedInvoiceEmail(inv.store_id, inv.id).then((res) => {
        if (!res.dispatched) {
          logger.warn(
            `[SifenPoller] email NOT dispatched for invoice ${inv.id} (reason=${res.reason})`,
          );
        } else {
          logger.info(
            `[SifenPoller] customer email dispatched for invoice ${inv.id}`,
          );
        }
      });
    }

    return resolvedAny;
  }

  /**
   * Backoff exponencial: 5min -> 10 -> 20 -> 40, cap 60 min. Despues de
   * POLL_MAX_ATTEMPTS marca como stuck y para de reintentar.
   */
  private async scheduleRetry(proto: PendingProtocol, reason: string): Promise<void> {
    const nextAttempts = proto.attempts + 1;

    if (nextAttempts >= POLL_MAX_ATTEMPTS) {
      logger.error(
        `[SifenPoller] giving up on protocol=${proto.protocolNumber} after ${nextAttempts} attempts (${reason})`,
      );
      await supabaseAdmin
        .from('invoices')
        .update({
          sifen_lote_poll_attempts: nextAttempts,
          sifen_lote_last_error: `Stuck after ${nextAttempts} polls: ${reason}`.slice(0, 1000),
          sifen_lote_next_poll_at: null,
        })
        .in('id', proto.invoiceIds);

      const uniqueStores = Array.from(new Set(proto.storeIds));
      for (const storeId of uniqueStores) {
        await emitOwnerAlert({
          storeId,
          alertType: 'invoice_polling_stuck',
          severity: 'critical',
          title: 'Lote SIFEN sin respuesta tras 24 intentos',
          message: `El lote ${proto.protocolNumber} no recibio respuesta de SIFEN despues de ${nextAttempts} consultas. Revisa el estado manualmente en e-Kuatia.`,
          metadata: {
            protocol_number: proto.protocolNumber,
            attempts: nextAttempts,
            reason,
          },
        });
      }
      return;
    }

    const backoffMinutes = Math.min(5 * Math.pow(2, proto.attempts), 60);
    const nextPollAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();

    await supabaseAdmin
      .from('invoices')
      .update({
        sifen_lote_poll_attempts: nextAttempts,
        sifen_lote_next_poll_at: nextPollAt,
        sifen_lote_last_error: reason.slice(0, 1000),
      })
      .in('id', proto.invoiceIds);

    logger.info(
      `[SifenPoller] retry scheduled protocol=${proto.protocolNumber} attempts=${nextAttempts} backoffMin=${backoffMinutes}`,
    );
  }

  private async applyProcessedResult(
    proto: PendingProtocol,
    result: SifenLoteResultResponse,
  ): Promise<void> {
    if (result.entries.length === 0) {
      // SIFEN dice "procesado" pero no devolvio entries. Tratamos como
      // error y reintentamos una vez.
      await this.scheduleRetry(proto, 'Lote procesado sin entries');
      return;
    }

    // Mapear por CDC. Algunas invoices del lote podrian no estar en
    // entries (caso raro pero defensivo).
    const { data: invoiceRows, error: loadErr } = await supabaseAdmin
      .from('invoices')
      .select('id, cdc, store_id, document_number, order_id')
      .in('id', proto.invoiceIds);

    if (loadErr) {
      logger.error(
        `[SifenPoller] failed to load invoices for protocol=${proto.protocolNumber}: ${loadErr.message}`,
      );
      return;
    }

    type InvoiceRow = {
      id: string;
      cdc: string | null;
      store_id: string;
      document_number: number;
      order_id: string | null;
    };
    const byCdc = new Map<string, InvoiceRow>();
    for (const inv of (invoiceRows ?? []) as InvoiceRow[]) {
      if (inv.cdc) byCdc.set(inv.cdc, inv);
    }

    const nowIso = new Date().toISOString();

    for (const entry of result.entries) {
      const inv = byCdc.get(entry.cdc);
      if (!inv) {
        logger.warn(
          `[SifenPoller] SIFEN entry for unknown CDC=${entry.cdc} protocol=${proto.protocolNumber}`,
        );
        continue;
      }

      const newStatus = entry.approved ? 'approved' : 'rejected';
      const patch: Record<string, unknown> = {
        sifen_status: newStatus,
        sifen_response_code: entry.responseCode,
        sifen_response_message: entry.responseMessage,
        sifen_lote_last_error: entry.approved ? null : entry.responseMessage,
      };
      if (entry.approved) {
        patch.approved_at = nowIso;
      }

      const { error: updErr } = await supabaseAdmin
        .from('invoices')
        .update(patch)
        .eq('id', inv.id);

      if (updErr) {
        logger.error(
          `[SifenPoller] update invoice ${inv.id} failed: ${updErr.message}`,
        );
        continue;
      }

      await logInvoiceEvent(inv.store_id, inv.id, newStatus, {
        async: true,
        protocol_number: proto.protocolNumber,
        response_code: entry.responseCode,
        response_message: entry.responseMessage,
        estado: entry.estado,
      });

      if (entry.approved) {
        // Owner alert informativa para visibilidad en el dashboard.
        await emitOwnerAlert({
          storeId: inv.store_id,
          alertType: 'invoice_approved_async',
          severity: 'low',
          title: 'Factura aprobada por SIFEN',
          message: `La factura ${inv.document_number} fue aprobada por SIFEN. CDC ${entry.cdc}.`,
          invoiceId: inv.id,
          orderId: inv.order_id,
          metadata: {
            protocol_number: proto.protocolNumber,
            cdc: entry.cdc,
            estado: entry.estado,
          },
        });

        // Dispatch customer email (PDF + QR). dispatchApprovedInvoiceEmail
        // re-arma el KUDE desde DB, respeta el gate isApproved, y nunca
        // throws. Fire-and-forget para no bloquear el ciclo del poller.
        void dispatchApprovedInvoiceEmail(inv.store_id, inv.id).then((res) => {
          if (!res.dispatched) {
            logger.warn(
              `[SifenPoller] email NOT dispatched for invoice ${inv.id} (reason=${res.reason})`,
            );
          } else {
            logger.info(
              `[SifenPoller] customer email dispatched for invoice ${inv.id}`,
            );
          }
        });
      } else {
        await emitOwnerAlert({
          storeId: inv.store_id,
          alertType: 'invoice_rejected_async',
          severity: 'high',
          title: 'Factura rechazada por SIFEN',
          message: `La factura ${inv.document_number} fue rechazada por SIFEN (${entry.responseCode}: ${entry.responseMessage}). Corregi los datos y usa Reintentar.`,
          invoiceId: inv.id,
          orderId: inv.order_id,
          metadata: {
            protocol_number: proto.protocolNumber,
            cdc: entry.cdc,
            estado: entry.estado,
            response_code: entry.responseCode,
            response_message: entry.responseMessage,
          },
        });
      }
    }

    logger.info(
      `[SifenPoller] lote processed protocol=${proto.protocolNumber} entries=${result.entries.length} approved=${result.entries.filter((e) => e.approved).length}`,
    );
  }

  private async markProtocolRejected(
    proto: PendingProtocol,
    code: string,
    message: string,
  ): Promise<void> {
    await supabaseAdmin
      .from('invoices')
      .update({
        sifen_status: 'rejected',
        sifen_response_code: code,
        sifen_response_message: message,
        sifen_lote_last_error: message.slice(0, 1000),
        sifen_lote_next_poll_at: null,
      })
      .in('id', proto.invoiceIds);

    const uniqueStores = Array.from(new Set(proto.storeIds));
    for (const storeId of uniqueStores) {
      await emitOwnerAlert({
        storeId,
        alertType: 'invoice_lote_not_found',
        severity: 'high',
        title: 'Lote SIFEN no encontrado',
        message: `SIFEN reporta que el lote ${proto.protocolNumber} no existe (${code}). Las facturas quedaron en estado rejected.`,
        metadata: {
          protocol_number: proto.protocolNumber,
          response_code: code,
          response_message: message,
        },
      });
    }
  }

  private async getKeyMaterial(identityId: string): Promise<SifenKeyMaterial | null> {
    const cached = this.keyCache.get(identityId);
    if (cached) return cached;
    try {
      const fresh = await loadCertificateMaterial(identityId);
      this.keyCache.set(identityId, fresh);
      return fresh;
    } catch (err) {
      logger.error(
        `[SifenPoller] loadCertificateMaterial failed identity=${identityId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

/**
 * SIFEN async dispatcher.
 *
 * Toma invoices con sifen_status='queued' (encoladas por
 * invoicing.service.signInjectSend cuando la identidad tiene
 * sifen_async_enabled=true), las agrupa por (identity_id, env), y las
 * envia a SIFEN por el WS asincrono siRecepLoteDE (Manual v150 9.2).
 *
 * Coordinacion con el resto del sistema:
 *   - Trigger pg_notify('sifen_invoice_queued') de migration 189
 *     despierta el dispatcher en sub-segundo. Cero polling en idle.
 *   - SELECT ... FOR UPDATE SKIP LOCKED permite escalar replicas en
 *     Railway sin race conditions. Cada replica toma su propio chunk.
 *   - sifen_lote_dispatch_key UNIQUE (migration 189) protege contra
 *     doble dispatch si el worker reinicia mid-flight. La key es
 *     PER-INVOICE y deterministica (sha256 de su propio xml_signed): un
 *     re-take regenera la misma key por fila, la UNIQUE la bloquea y el
 *     dispatch de esa invoice queda idempotente. Per-invoice (no per-lote)
 *     para que un lote con >1 DE de la misma identidad no colisione consigo
 *     mismo en la UNIQUE.
 *
 * Lote layout:
 *   - Hasta 50 DEs del mismo (identity_id, tipo_documento, env)
 *   - Cada DE ya viene firmado en invoices.xml_signed
 *   - Se construye <rLoteDE>, se zipea, se base64a, se envia dentro de
 *     <rEnvioLote> via sendDELote(...)
 *
 * Backoff: si el batch falla por motivo transitorio (timeout, 5xx) las
 * invoices vuelven a 'queued' para el proximo tick. Si SIFEN responde
 * 0301 (lote rechazado por estructura) se marcan como 'rejected' con
 * mensaje, dado que reintentar el mismo lote daria el mismo error.
 */

import crypto from 'crypto';
import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';
import {
  sendDELote,
  type SifenLoteResponse,
  type SifenMtls,
} from '../services/sifen/sifen-client';
import { loadCertificateMaterial } from '../services/invoicing.service';
import { SifenKeyCache, type SifenKeyMaterial } from './shared/key-cache';
import { SifenRealtimeListener } from './shared/realtime-listener';

// ================================================================
// Configuracion
// ================================================================

/**
 * Max DEs por lote. Manual v150 9.2: 50 hard cap. Mantenemos 50 para
 * minimizar requests SIFEN (1000 tiendas con 10 DE/dia = 200 lotes/dia
 * vs 10k requests sync).
 */
const MAX_DES_PER_LOTE = 50;

/**
 * Ventana de espera para acumular mas DEs antes de cerrar el lote.
 * Si llegan 50 antes, cierra inmediato. Si llega 1 solo, espera hasta
 * este maximo. Trade-off: bajo = latencia menor por DE, alto = mejor
 * batching. 30s es balance razonable para volumen medio.
 */
const BATCH_WINDOW_MS = 30_000;

/**
 * Timeout completo de un ciclo de dispatch (signXmlLoad + zip + send).
 * Despues de esto el AbortController cancela el request HTTPS subyacente.
 * Tiene que ser >= TIMEOUT_MS del cliente HTTP (90s) o el cycleAbort
 * dispara antes y todos los lotes terminan en "SIFEN request aborted".
 * 120s deja 30s de margen para zip + DB ops adicionales del ciclo.
 */
const DISPATCH_TIMEOUT_MS = 120_000;

/**
 * Periodo del cron fallback. NOTIFY despierta el dispatcher casi
 * inmediato; este timer existe solo para barrer invoices que quedaron
 * 'queued' si por alguna razon la notif no llego (reinicio del worker
 * entre el INSERT y la conexion del LISTEN, por ejemplo).
 */
const FALLBACK_SWEEP_MS = 60_000;

/**
 * Limite de invoices a tomar en un solo barrido. Acotar protege contra
 * spikes (1000 invoices encoladas todas juntas no deben colapsar memoria
 * o el statement timeout de Supabase). Cada barrido despues vuelve a
 * pedir mas.
 */
const SWEEP_LIMIT = 500;

/**
 * Cap de reintentos transient antes de marcar el lote como rejected.
 * Con TIMEOUT_MS=90s y sweep cada 60s, 5 intentos cubren ~7-10 min de
 * caida SIFEN antes de cortar. Despues de eso, el owner ve el rejected
 * y puede reintentar manualmente cuando SIFEN se recupere.
 */
const MAX_DISPATCH_ATTEMPTS = 5;

const KEY_CACHE_OPTIONS = { max: 100, ttlMs: 5 * 60 * 1_000 };

// ================================================================
// Manual-only emission switch
// ================================================================

/**
 * Reversible kill switch para el AUTO-dispatch.
 *
 * Contexto (incidente fiscal 2026-06): el egress de Railway (152.55.184.63)
 * no alcanza a SET; cada envio worker->SIFEN da timeout/socket hang up. El
 * owner pidio explicitamente que las facturas pending/queued/rejected NO se
 * reintenten solas. Este flag apaga el LAZO automatico (NOTIFY + sweep timer
 * + barrido de arranque) sin tocar la logica de envio.
 *
 * Default: OFF. La emision y el reintento ocurren SOLO via trigger manual
 * (script `sifen-drain.ts` o el endpoint de retry, que re-encola y deja que
 * un humano corra el drain). Para reactivar el auto-dispatch una vez que el
 * egress este arreglado: setear SIFEN_AUTO_DISPATCH=true en Railway. Cero
 * cambio de codigo, cero deploy de logica.
 *
 * Acepta '1' o 'true' (case-insensitive) como ON. Cualquier otra cosa
 * (incluida la ausencia de la variable) es OFF.
 */
export function isAutoDispatchEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.SIFEN_AUTO_DISPATCH ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

// ================================================================
// Estado interno
// ================================================================

interface PendingInvoiceRow {
  id: string;
  store_id: string;
  identity_id: string;
  document_number: number;
  tipo_documento: number;
  xml_signed: string | null;
  sifen_environment: 'test' | 'prod';
}

export class SifenDispatcher {
  private readonly keyCache = new SifenKeyCache(KEY_CACHE_OPTIONS);
  private readonly abortController = new AbortController();

  private wakeTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private cycleInFlight: Promise<void> | null = null;

  constructor(private readonly listener: SifenRealtimeListener) {}

  async start(): Promise<void> {
    if (this.stopped) throw new Error('Dispatcher stopped, create a new instance');
    if (this.running) return;
    this.running = true;

    // Manual-only emission: si el auto-dispatch esta apagado NO conectamos
    // el listener NOTIFY, NO armamos el sweep timer y NO hacemos el barrido
    // de arranque. La unica forma de drenar la cola es el trigger manual
    // (drainOnce, via script). Las invoices queued/rejected quedan quietas.
    if (!isAutoDispatchEnabled()) {
      logger.warn(
        '[SifenDispatcher] AUTO-DISPATCH OFF (SIFEN_AUTO_DISPATCH!=true). ' +
          'No NOTIFY listener, no sweep, no boot drain. La cola SIFEN solo ' +
          'se envia con el trigger manual. Para reactivar: SIFEN_AUTO_DISPATCH=true.',
      );
      logger.info('[SifenDispatcher] started (manual-only mode)');
      return;
    }

    this.listener.on('sifen_invoice_queued', () => {
      this.scheduleWake();
    });

    // Fallback periodico por si el NOTIFY se pierde.
    this.sweepTimer = setInterval(() => {
      this.scheduleWake();
    }, FALLBACK_SWEEP_MS);
    this.sweepTimer.unref();

    // Primer barrido inmediato al arrancar para drenar lo que haya quedado
    // queued antes de que el listener se conectara.
    this.scheduleWake();

    logger.info('[SifenDispatcher] started (auto-dispatch ON)');
  }

  /**
   * Trigger MANUAL de envio. Drena la cola SIFEN una sola vez, en el caller,
   * sin armar timers ni listeners. Es el unico camino de emision cuando
   * SIFEN_AUTO_DISPATCH esta OFF: lo invoca un humano via el script
   * `api/scripts/sifen-drain.ts`.
   *
   * Reusa exactamente la misma logica de envio que el lazo automatico
   * (fetchQueuedInvoices -> agrupar -> sendDELote), pero corre inline y
   * resuelve cuando termina, asi el script sabe cuando salir. No reintenta
   * solo: una pasada y vuelve. Si quedan invoices queued (porque el egress
   * sigue roto) el humano decide si vuelve a correrlo.
   *
   * NO releasa orphan-claims ni re-encola nada por su cuenta. Solo toma lo
   * que ya esta en estado 'queued' con dispatch_key NULL.
   */
  async drainOnce(): Promise<void> {
    if (this.stopped) throw new Error('Dispatcher stopped, create a new instance');
    // Marcamos running para que processQueue/dispatchLote no aborten por el
    // guard `if (!this.running) return`. No tocamos timers ni listeners.
    const wasRunning = this.running;
    this.running = true;
    try {
      logger.info('[SifenDispatcher] manual drain started');
      await this.processQueue();
      logger.info('[SifenDispatcher] manual drain finished');
    } finally {
      this.running = wasRunning;
    }
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
        /* swallow: shutdown */
      }
    }

    this.keyCache.clear();
    logger.info('[SifenDispatcher] stopped');
  }

  /** Coalesce de wakeups en una ventana corta para batchear NOTIFYs. */
  private scheduleWake(): void {
    if (!this.running) return;
    if (this.wakeTimer) return; // ya hay uno programado
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.runCycle();
    }, BATCH_WINDOW_MS);
    this.wakeTimer.unref();
  }

  private runCycle(): void {
    if (!this.running) return;
    if (this.cycleInFlight) {
      // Ya hay uno corriendo. El proximo NOTIFY o sweep va a re-disparar.
      return;
    }
    this.cycleInFlight = this.processQueue()
      .catch((err) => {
        logger.error(
          `[SifenDispatcher] cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        this.cycleInFlight = null;
      });
  }

  private async processQueue(): Promise<void> {
    const rows = await this.fetchQueuedInvoices();
    if (rows.length === 0) return;

    // Group by (identity_id, tipo_documento, env): SIFEN requiere lote
    // homogeneo por tipo de DE, y nosotros queremos un solo cert/mTLS
    // por lote, asi que tambien por identity.
    const groups = new Map<string, PendingInvoiceRow[]>();
    for (const row of rows) {
      const key = `${row.identity_id}|${row.tipo_documento}|${row.sifen_environment}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }

    for (const bucket of groups.values()) {
      // Subdividir en lotes de hasta 50.
      for (let i = 0; i < bucket.length; i += MAX_DES_PER_LOTE) {
        const slice = bucket.slice(i, i + MAX_DES_PER_LOTE);
        if (!this.running) return;
        await this.dispatchLote(slice);
      }
    }
  }

  private async fetchQueuedInvoices(): Promise<PendingInvoiceRow[]> {
    // Nota: supabase-js no expone SELECT FOR UPDATE SKIP LOCKED directo.
    // Usamos un RPC sencillo: tomar las invoices, asignarles un
    // dispatch_key provisorio y reservarlas en un UPDATE atomico.
    //
    // El UPDATE filtra por sifen_status='queued' AND dispatch_key IS NULL
    // para evitar pisar invoices ya en flight. La UNIQUE constraint en
    // dispatch_key garantiza que dos replicas no escriban la misma key.
    //
    // Mantenemos el claim corto: solo seteamos un placeholder 'CLAIM:<uuid>'
    // y antes de enviar a SIFEN sobreescribimos con el hash real del XML
    // del lote. Si el worker crashea entre el claim y el send, el sweep
    // siguiente las ve con dispatch_key='CLAIM:*' y NO las re-toma; un
    // job de housekeeping puede limpiar claims viejos.

    const { data: claimed, error } = await supabaseAdmin
      .from('invoices')
      .select(
        'id, store_id, identity_id, document_number, tipo_documento, xml_signed, fiscal_identities!inner(sifen_environment)',
      )
      .eq('sifen_status', 'queued')
      .is('sifen_lote_dispatch_key', null)
      .not('xml_signed', 'is', null)
      .order('created_at', { ascending: true })
      .limit(SWEEP_LIMIT);

    if (error) {
      logger.error(`[SifenDispatcher] fetch queued failed: ${error.message}`);
      return [];
    }
    if (!claimed || claimed.length === 0) return [];

    // supabase-js typea el embedded join como array aunque la FK sea
    // 1-to-1. Convertimos manualmente al primer elemento, defendiendo
    // contra payload vacio.
    type ClaimedRow = {
      id: string;
      store_id: string;
      identity_id: string | null;
      document_number: number;
      tipo_documento: number;
      xml_signed: string | null;
      fiscal_identities: { sifen_environment: string } | Array<{ sifen_environment: string }> | null;
    };
    const rows: PendingInvoiceRow[] = [];
    for (const r of claimed as unknown as ClaimedRow[]) {
      const fi = Array.isArray(r.fiscal_identities)
        ? r.fiscal_identities[0]
        : r.fiscal_identities;
      const env = fi?.sifen_environment;
      if (!r.identity_id || !r.xml_signed) continue;
      if (env !== 'test' && env !== 'prod') continue; // demo no llega aca
      rows.push({
        id: r.id,
        store_id: r.store_id,
        identity_id: r.identity_id,
        document_number: r.document_number,
        tipo_documento: r.tipo_documento,
        xml_signed: r.xml_signed,
        sifen_environment: env,
      });
    }
    return rows;
  }

  private async dispatchLote(invoices: PendingInvoiceRow[]): Promise<void> {
    if (invoices.length === 0) return;

    const identityId = invoices[0].identity_id;
    const env = invoices[0].sifen_environment;
    const tipo = invoices[0].tipo_documento;
    const signedDEs = invoices.map((i) => i.xml_signed!).filter(Boolean);

    if (signedDEs.length !== invoices.length) {
      logger.error(
        `[SifenDispatcher] lote dropped: missing xml_signed on some invoices identity=${identityId}`,
      );
      return;
    }

    // loteHash deterministico del contenido completo del lote. Se usa para
    // el dispatchId (<dId>) y el logging, NO como dispatch_key persistido.
    const loteHash = crypto
      .createHash('sha256')
      .update(signedDEs.join('|'))
      .digest('hex')
      .slice(0, 40);

    // dispatch_key PER-INVOICE, no per-lote. Cada invoice deriva su propia
    // key deterministica de su PROPIO xml_signed. Esto:
    //   - evita la colision UNIQUE cuando un lote tiene >1 invoice de la
    //     misma identidad (antes todas compartian el mismo hash de lote y
    //     la segunda fila violaba uniq_invoices_sifen_lote_dispatch_key).
    //   - preserva la idempotencia per-invoice: si el worker reinicia y
    //     vuelve a tomar la misma invoice, regenera la misma key y la
    //     UNIQUE bloquea el doble dispatch de esa fila.
    // sha256(xml_signed) es estable mientras el XML firmado no cambie (la
    // firma incluye timbrado/CDC/fecha, asi que dos invoices distintas
    // nunca colisionan). Truncado a 40 chars para caber en VARCHAR(64).
    const keyForInvoice = (xmlSigned: string): string =>
      crypto.createHash('sha256').update(xmlSigned).digest('hex').slice(0, 40);

    // Reservar invoice por invoice. Un solo UPDATE bulk no sirve porque
    // necesitamos un valor distinto por fila. El loop es chico (lote <= 50)
    // y cada UPDATE es atomico: el guard `.is(sifen_lote_dispatch_key, null)`
    // + la UNIQUE garantizan que dos replicas no reserven la misma invoice.
    const submittedAt = new Date().toISOString();
    const reservedIds: string[] = [];
    for (const inv of invoices) {
      const invoiceKey = keyForInvoice(inv.xml_signed!);
      const { data: rowReserved, error: reserveErr } = await supabaseAdmin
        .from('invoices')
        .update({
          sifen_lote_dispatch_key: invoiceKey,
          sifen_lote_submitted_at: submittedAt,
        })
        .eq('id', inv.id)
        .eq('sifen_status', 'queued')
        .is('sifen_lote_dispatch_key', null)
        .select('id');

      if (reserveErr) {
        // 23505 (unique_violation) = otra replica/un re-take ya reservo esta
        // invoice con la misma key deterministica. Es la proteccion de
        // doble dispatch funcionando: la salteamos, no la enviamos de nuevo.
        if (reserveErr.code === '23505') {
          logger.info(
            `[SifenDispatcher] invoice ${inv.id} already claimed (idempotency), skipping identity=${identityId}`,
          );
          continue;
        }
        logger.error(
          `[SifenDispatcher] reserve failed invoice=${inv.id} identity=${identityId}: ${reserveErr.message}`,
        );
        continue;
      }
      if ((rowReserved ?? []).length > 0) {
        reservedIds.push(inv.id);
      }
    }

    if (reservedIds.length === 0) {
      logger.info(
        `[SifenDispatcher] race lost, all invoices already claimed identity=${identityId}`,
      );
      return;
    }
    // Subset que realmente reservamos
    const reservedSet = new Set(reservedIds);
    const finalInvoices = invoices.filter((i) => reservedSet.has(i.id));
    const finalSignedDEs = finalInvoices.map((i) => i.xml_signed!);

    // dispatchId que mandamos en <dId>. Maximo 15 digitos numericos.
    // Tomamos los primeros 15 chars decimales del hash del lote convertidos
    // a numero positivo, asi es deterministico y dentro del rango. El SEND
    // sigue siendo un solo lote agrupado; solo la key persistida es per-row.
    const dispatchId = String(
      BigInt('0x' + loteHash.slice(0, 15)) % BigInt(1_000_000_000_000_000n),
    ).padStart(1, '0');

    const material = await this.getKeyMaterial(identityId);
    if (!material) {
      await this.markBatchRejected(
        reservedIds,
        'CERT_LOAD',
        'Certificado digital no disponible para la identidad',
      );
      return;
    }
    const mtls: SifenMtls = {
      certPem: material.certPem,
      privateKeyPem: material.privateKeyPem,
    };

    const cycleAbort = new AbortController();
    const timeout = setTimeout(() => cycleAbort.abort(), DISPATCH_TIMEOUT_MS);
    timeout.unref();
    const onParentAbort = () => cycleAbort.abort();
    this.abortController.signal.addEventListener('abort', onParentAbort, { once: true });

    let response: SifenLoteResponse;
    try {
      response = await sendDELote(
        dispatchId,
        finalSignedDEs,
        env,
        mtls,
        cycleAbort.signal,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Reuse sifen_lote_poll_attempts as a counter for dispatch failures
      // too -- semantically it tracks "lote-related retries" and avoids
      // adding another column. Cap at MAX_DISPATCH_ATTEMPTS so a SIFEN
      // outage doesn't generate an infinite retry loop across sweeps.
      const { data: existing } = await supabaseAdmin
        .from('invoices')
        .select('id, sifen_lote_poll_attempts')
        .in('id', reservedIds);
      const maxAttempts = Math.max(
        ...((existing ?? []).map((r) => r.sifen_lote_poll_attempts ?? 0)),
        0,
      );
      const nextAttempts = maxAttempts + 1;

      if (nextAttempts >= MAX_DISPATCH_ATTEMPTS) {
        logger.error(
          `[SifenDispatcher] giving up dispatch=${loteHash} count=${finalInvoices.length} identity=${identityId} after ${nextAttempts} transient failures: ${message}`,
        );
        await supabaseAdmin
          .from('invoices')
          .update({
            sifen_status: 'rejected',
            sifen_lote_poll_attempts: nextAttempts,
            sifen_response_code: 'DSP_FAIL',
            sifen_response_message: `Dispatch fallo ${nextAttempts}x: ${message.slice(0, 200)}`,
            sifen_lote_dispatch_key: null,
            sifen_lote_submitted_at: null,
            sifen_lote_last_error: message.slice(0, 1000),
          })
          .in('id', reservedIds);
        return;
      }

      logger.warn(
        `[SifenDispatcher] transient send failure dispatch=${loteHash} count=${finalInvoices.length} identity=${identityId} attempts=${nextAttempts}/${MAX_DISPATCH_ATTEMPTS}: ${message}`,
      );
      // Transient: devolver al estado queued limpiando dispatch_key, asi
      // el proximo tick las vuelve a tomar. Incrementamos attempts para
      // detectar caidas prolongadas y cortar el loop antes de saturar.
      await supabaseAdmin
        .from('invoices')
        .update({
          sifen_lote_dispatch_key: null,
          sifen_lote_submitted_at: null,
          sifen_lote_poll_attempts: nextAttempts,
          sifen_lote_last_error: message.slice(0, 1000),
        })
        .in('id', reservedIds);
      return;
    } finally {
      clearTimeout(timeout);
      this.abortController.signal.removeEventListener('abort', onParentAbort);
    }

    if (response.success && response.protocolNumber) {
      // Lote encolado en SIFEN. Programar el primer poll.
      const dTpoSecs = response.processingTimeSeconds ?? 60;
      // Manual v150 8.2.2 dice usar dTpoProces como referencia. Aplicamos
      // un factor de seguridad para no llegar antes de tiempo a SIFEN.
      const firstPollDelaySecs = Math.max(60, Math.min(dTpoSecs * 2, 600));
      const nextPollAt = new Date(Date.now() + firstPollDelaySecs * 1_000).toISOString();

      const { error: updErr } = await supabaseAdmin
        .from('invoices')
        .update({
          sifen_status: 'sent',
          sifen_protocol_number: response.protocolNumber,
          sifen_lote_next_poll_at: nextPollAt,
          sifen_lote_last_error: null,
          sent_to_sifen_at: new Date().toISOString(),
          sifen_response_code: response.responseCode,
          sifen_response_message: response.responseMessage,
        })
        .in('id', reservedIds);

      if (updErr) {
        logger.error(
          `[SifenDispatcher] update sent failed dispatch=${loteHash}: ${updErr.message}`,
        );
        return;
      }

      logger.info(
        `[SifenDispatcher] lote sent dispatch=${loteHash} count=${finalInvoices.length} identity=${identityId} protocol=${response.protocolNumber} firstPoll=${firstPollDelaySecs}s`,
      );
    } else {
      // SIFEN rechazo el lote (0301 u otro). Marcar rejected, owner_alert
      // por invoice. Reintentar exactamente el mismo lote daria el mismo
      // error, asi que no lo re-encolamos automaticamente.
      await this.markBatchRejected(
        reservedIds,
        response.responseCode,
        response.responseMessage,
      );
      logger.warn(
        `[SifenDispatcher] lote rejected dispatch=${loteHash} count=${finalInvoices.length} identity=${identityId} code=${response.responseCode} msg=${response.responseMessage}`,
      );
    }
  }

  private async markBatchRejected(
    invoiceIds: string[],
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
      })
      .in('id', invoiceIds);
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
        `[SifenDispatcher] loadCertificateMaterial failed identity=${identityId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

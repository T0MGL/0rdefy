/**
 * Webhook Queue Service
 *
 * CRÍTICO para producción: Maneja picos de tráfico encolando webhooks
 * y procesándolos asincrónicamente para evitar timeouts.
 *
 * Shopify requiere respuesta en < 5 segundos, este sistema garantiza:
 * - Respuesta inmediata (< 1 segundo)
 * - Procesamiento asíncrono sin límite de tiempo
 * - Resistencia a picos altos (Black Friday, flash sales)
 *
 * Referencia: https://shopify.dev/docs/apps/build/webhooks/subscribe/https
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ShopifyWebhookService } from './shopify-webhook.service';
import { ShopifyWebhookManager } from './shopify-webhook-manager.service';
import { logger } from '../utils/logger';

interface WebhookQueueItem {
  id: string;
  integration_id: string;
  store_id: string;
  topic: string;
  payload: any;
  headers: {
    'X-Shopify-Shop-Domain': string;
    'X-Shopify-Hmac-Sha256': string;
  };
  idempotency_key: string;
  created_at: string;
  retry_count: number;
  max_retries: number;
  next_retry_at: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

export class WebhookQueueService {
  private supabase: SupabaseClient;
  private processing: boolean = false;
  private startingLock: boolean = false; // Guard against concurrent startProcessing() calls
  private queueRunInProgress: boolean = false; // Prevent overlapping processQueue runs
  private concurrentLimit: number = 10; // Procesar 10 webhooks simultáneamente
  private pollingInterval: number = 1000; // Revisar cada 1 segundo
  private intervalId?: NodeJS.Timeout;

  // Reutilizar instancias para evitar presión de memoria y GC pauses
  // Estos servicios son stateless, seguros para reutilizar
  private webhookService: ShopifyWebhookService;
  private webhookManager: ShopifyWebhookManager;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.webhookService = new ShopifyWebhookService(supabase);
    this.webhookManager = new ShopifyWebhookManager(supabase);
  }

  /**
   * Encolar webhook para procesamiento asíncrono
   * Retorna inmediatamente para cumplir con el timeout de Shopify (< 5s)
   */
  async enqueue(item: Omit<WebhookQueueItem, 'id' | 'created_at' | 'retry_count' | 'max_retries' | 'next_retry_at' | 'status'>): Promise<string> {
    try {
      const { data, error } = await this.supabase
        .from('webhook_queue')
        .insert({
          integration_id: item.integration_id,
          store_id: item.store_id,
          topic: item.topic,
          payload: item.payload,
          headers: item.headers,
          idempotency_key: item.idempotency_key,
          retry_count: 0,
          max_retries: 5,
          next_retry_at: new Date().toISOString(),
          status: 'pending',
        })
        .select('id')
        .single();

      if (error) {
        logger.error('BACKEND', '❌ [WEBHOOK-QUEUE] Error enqueuing webhook:', error);
        throw error;
      }

      logger.info('BACKEND', `✅ [WEBHOOK-QUEUE] Enqueued webhook: ${data.id} (topic: ${item.topic})`);
      return data.id;
    } catch (error) {
      logger.error('BACKEND', '❌ [WEBHOOK-QUEUE] Fatal error enqueuing webhook:', error);
      throw error;
    }
  }

  /**
   * Iniciar procesamiento de la cola
   * Procesa webhooks pendientes en background
   *
   * Uses double-check pattern to prevent race conditions when called concurrently.
   * The startingLock prevents multiple callers from entering the critical section
   * simultaneously, avoiding duplicate intervals.
   */
  startProcessing(): void {
    // Fast path: already processing
    if (this.processing) {
      logger.warn('BACKEND', '⚠️ [WEBHOOK-QUEUE] Processing already started');
      return;
    }

    // Acquire lock to prevent concurrent initialization
    if (this.startingLock) {
      logger.warn('BACKEND', '⚠️ [WEBHOOK-QUEUE] startProcessing() already in progress');
      return;
    }
    this.startingLock = true;

    try {
      // Double-check after acquiring lock
      if (this.processing) {
        logger.warn('BACKEND', '⚠️ [WEBHOOK-QUEUE] Processing already started (double-check)');
        return;
      }

      // Clear any existing interval before creating a new one
      if (this.intervalId) {
        logger.warn('BACKEND', '⚠️ [WEBHOOK-QUEUE] Clearing orphaned interval');
        clearInterval(this.intervalId);
        this.intervalId = undefined;
      }

      logger.info('BACKEND', '🚀 [WEBHOOK-QUEUE] Starting webhook queue processor');
      this.processing = true;

      // Procesar inmediatamente
      void this.processQueue();

      // Configurar polling para procesar continuamente
      this.intervalId = setInterval(() => {
        void this.processQueue();
      }, this.pollingInterval);
    } finally {
      this.startingLock = false;
    }
  }

  /**
   * Detener procesamiento de la cola
   */
  stopProcessing(): void {
    logger.info('BACKEND', '🛑 [WEBHOOK-QUEUE] Stopping webhook queue processor');
    this.processing = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Procesar webhooks pendientes de la cola
   */
  private async processQueue(): Promise<void> {
    if (!this.processing) {
      return;
    }

    if (this.queueRunInProgress) {
      logger.debug('BACKEND', '⏭️ [WEBHOOK-QUEUE] Skipping tick: previous batch still running');
      return;
    }

    this.queueRunInProgress = true;

    try {
      // Obtener webhooks pendientes que estén listos para procesar
      const { data: pendingWebhooks, error } = await this.supabase
        .from('webhook_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('next_retry_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(this.concurrentLimit);

      if (error) {
        logger.error('BACKEND', '❌ [WEBHOOK-QUEUE] Error fetching pending webhooks:', error);
        return;
      }

      if (!pendingWebhooks || pendingWebhooks.length === 0) {
        return; // No hay webhooks pendientes
      }

      logger.info('BACKEND', `🔄 [WEBHOOK-QUEUE] Processing ${pendingWebhooks.length} webhooks...`);

      // Procesar todos en paralelo (hasta el límite de concurrencia)
      const promises = pendingWebhooks.map(webhook =>
        this.processWebhook(webhook as WebhookQueueItem)
      );

      await Promise.allSettled(promises);

    } catch (error) {
      logger.error('BACKEND', '❌ [WEBHOOK-QUEUE] Error processing queue:', error);
    } finally {
      this.queueRunInProgress = false;
    }
  }

  /**
   * Procesar un webhook individual
   */
  private async processWebhook(webhook: WebhookQueueItem): Promise<void> {
    const startTime = Date.now();

    try {
      // Claim atómico: solo una ejecución puede pasar de pending -> processing
      const { data: claimedWebhook, error: claimError } = await this.supabase
        .from('webhook_queue')
        .update({ status: 'processing' })
        .eq('id', webhook.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();

      if (claimError) {
        logger.error('BACKEND', `❌ [WEBHOOK-QUEUE] Error claiming webhook ${webhook.id}:`, claimError);
        return;
      }

      if (!claimedWebhook) {
        logger.debug('BACKEND', `⏭️ [WEBHOOK-QUEUE] Webhook ${webhook.id} already claimed by another worker`);
        return;
      }

      const activeWebhook = claimedWebhook as WebhookQueueItem;

      logger.info('BACKEND', `⏳ [WEBHOOK-QUEUE] Processing webhook ${activeWebhook.id} (topic: ${activeWebhook.topic})`);

      // Procesar según el topic
      // IMPORTANTE: Usar supabaseAdmin para evitar errores de RLS
      let result: any;

      switch (activeWebhook.topic) {
        case 'orders/create':
          result = await this.webhookService.processOrderCreatedWebhook(
            activeWebhook.payload,
            activeWebhook.store_id,
            activeWebhook.integration_id
          );
          break;

        case 'orders/updated':
          result = await this.webhookService.processOrderUpdatedWebhook(
            activeWebhook.payload,
            activeWebhook.store_id,
            activeWebhook.integration_id
          );
          break;

        case 'products/update':
          result = await this.webhookService.processProductUpdatedWebhook(
            activeWebhook.payload,
            activeWebhook.store_id,
            activeWebhook.integration_id
          );
          break;

        case 'products/delete':
          result = await this.webhookService.processProductDeletedWebhook(
            activeWebhook.payload.id,
            activeWebhook.store_id,
            activeWebhook.integration_id
          );
          break;

        default:
          logger.warn('BACKEND', `⚠️ [WEBHOOK-QUEUE] Unknown topic: ${activeWebhook.topic}`);
          result = { success: false, error: 'Unknown topic' };
      }

      const processingTime = Date.now() - startTime;

      if (result.success) {
        // Éxito - marcar como completado
        await this.supabase
          .from('webhook_queue')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString(),
          })
          .eq('id', activeWebhook.id)
          .eq('status', 'processing');

        // Registrar métrica
        await this.webhookManager.recordMetric(
          activeWebhook.integration_id,
          activeWebhook.store_id,
          'processed',
          processingTime
        );

        logger.info('BACKEND', `✅ [WEBHOOK-QUEUE] Webhook ${activeWebhook.id} completed in ${processingTime}ms`);

      } else {
        // Error - reintentar o marcar como fallido
        await this.handleWebhookError(activeWebhook, result.error || 'Unknown error');
      }

    } catch (error: any) {
      logger.error('BACKEND', `❌ [WEBHOOK-QUEUE] Error processing webhook ${webhook.id}:`, error);
      await this.handleWebhookError(webhook, error.message);
    }
  }

  /**
   * Manejar errores de procesamiento de webhooks
   */
  private async handleWebhookError(webhook: WebhookQueueItem, error: string): Promise<void> {
    const newRetryCount = webhook.retry_count + 1;
    const maxed = newRetryCount >= webhook.max_retries;

    if (maxed) {
      // Máximo de reintentos alcanzado - marcar como fallido
      await this.supabase
        .from('webhook_queue')
        .update({
          status: 'failed',
          retry_count: newRetryCount,
          error: error.substring(0, 1000),
          processed_at: new Date().toISOString(),
        })
        .eq('id', webhook.id)
        .eq('status', 'processing');

      // Registrar métrica de fallo
      await this.webhookManager.recordMetric(
        webhook.integration_id,
        webhook.store_id,
        'failed',
        0,
        '500'
      );

      logger.error('BACKEND', `❌ [WEBHOOK-QUEUE] Webhook ${webhook.id} failed permanently after ${newRetryCount} attempts`);

    } else {
      // Programar siguiente reintento con exponential backoff
      const backoffSeconds = Math.min(60 * Math.pow(2, newRetryCount), 3600); // 60s, 120s, 240s, ... max 1h
      const nextRetryAt = new Date();
      nextRetryAt.setSeconds(nextRetryAt.getSeconds() + backoffSeconds);

      await this.supabase
        .from('webhook_queue')
        .update({
          status: 'pending',
          retry_count: newRetryCount,
          next_retry_at: nextRetryAt.toISOString(),
          error: error.substring(0, 1000),
        })
        .eq('id', webhook.id)
        .eq('status', 'processing');

      logger.info('BACKEND', 
        `⏳ [WEBHOOK-QUEUE] Webhook ${webhook.id} will retry in ${backoffSeconds}s (attempt ${newRetryCount}/${webhook.max_retries})`
      );
    }
  }

  /**
   * Obtener estadísticas de la cola
   */
  async getQueueStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  }> {
    const { data, error } = await this.supabase
      .from('webhook_queue')
      .select('status')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // últimas 24 horas

    if (error || !data) {
      logger.error('BACKEND', '❌ [WEBHOOK-QUEUE] Error fetching queue stats:', error);
      return { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
    }

    const stats = data.reduce((acc, item) => {
      acc[item.status as keyof typeof acc]++;
      acc.total++;
      return acc;
    }, { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 });

    return stats;
  }

  /**
   * Limpiar webhooks antiguos completados (> 7 días)
   */
  async cleanupOldWebhooks(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await this.supabase
      .from('webhook_queue')
      .delete()
      .eq('status', 'completed')
      .lt('created_at', sevenDaysAgo.toISOString())
      .select('id');

    if (error) {
      logger.error('BACKEND', '❌ [WEBHOOK-QUEUE] Error cleaning up old webhooks:', error);
      return 0;
    }

    const deleted = data?.length || 0;
    logger.info('BACKEND', `🧹 [WEBHOOK-QUEUE] Cleaned up ${deleted} old completed webhooks`);
    return deleted;
  }
}

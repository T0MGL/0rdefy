/**
 * Reconciliation Service
 *
 * CRÍTICO: Job de reconciliación para recuperar datos perdidos de Shopify
 * Shopify recomienda crear este job para casos donde webhooks fallen
 *
 * Este servicio:
 * - Sincroniza órdenes nuevas que no llegaron via webhook
 * - Detecta gaps en la sincronización
 * - Actualiza productos y clientes desactualizados
 * - Se ejecuta automáticamente cada hora
 *
 * Referencia: https://shopify.dev/docs/apps/build/webhooks/subscribe/https
 */

import { logger } from '../utils/logger';
import { SupabaseClient } from '@supabase/supabase-js';
import { ShopifyClientService } from './shopify-client.service';
import { ShopifyWebhookService } from './shopify-webhook.service';

export class ReconciliationService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Ejecutar reconciliación completa para todas las integraciones activas
   */
  async runFullReconciliation(): Promise<{
    success: boolean;
    integrations_processed: number;
    orders_synced: number;
    products_synced: number;
    customers_synced: number;
    errors: string[];
  }> {
    const startTime = Date.now();
    logger.info('BACKEND', '🔄 [RECONCILIATION] Starting full reconciliation...');

    const results = {
      success: true,
      integrations_processed: 0,
      orders_synced: 0,
      products_synced: 0,
      customers_synced: 0,
      errors: [] as string[],
    };

    try {
      // Obtener todas las integraciones activas
      const { data: integrations, error } = await this.supabase
        .from('shopify_integrations')
        .select('*')
        .eq('status', 'active');

      if (error) throw error;

      if (!integrations || integrations.length === 0) {
        logger.info('BACKEND', 'ℹ️ [RECONCILIATION] No active integrations found');
        return results;
      }

      logger.info('BACKEND', `📊 [RECONCILIATION] Found ${integrations.length} active integrations`);

      // Procesar cada integración
      for (const integration of integrations) {
        try {
          logger.info('BACKEND', `\n🔄 [RECONCILIATION] Processing integration: ${integration.shop_domain}`);

          // Reconciliar órdenes (más crítico)
          const orderResults = await this.reconcileOrders(integration);
          results.orders_synced += orderResults.synced;

          // Reconciliar productos
          const productResults = await this.reconcileProducts(integration);
          results.products_synced += productResults.synced;

          // Reconciliar clientes
          const customerResults = await this.reconcileCustomers(integration);
          results.customers_synced += customerResults.synced;

          results.integrations_processed++;

        } catch (error: any) {
          logger.error('BACKEND', `❌ [RECONCILIATION] Error processing ${integration.shop_domain}:`, error);
          results.errors.push(`${integration.shop_domain}: ${error.message}`);
          results.success = false;
        }
      }

      const duration = Date.now() - startTime;
      logger.info('BACKEND', '\n✅ [RECONCILIATION] Completed reconciliation in', duration, 'ms');
      logger.info('BACKEND', '📊 [RECONCILIATION] Results:', results);

      return results;

    } catch (error: any) {
      logger.error('BACKEND', '❌ [RECONCILIATION] Fatal error:', error);
      results.success = false;
      results.errors.push(error.message);
      return results;
    }
  }

  /**
   * Reconciliar órdenes nuevas que no llegaron via webhook
   */
  private async reconcileOrders(integration: any): Promise<{ synced: number }> {
    try {
      const shopifyClient = new ShopifyClientService(integration);
      const webhookService = new ShopifyWebhookService(this.supabase);

      // Obtener la última orden sincronizada
      const { data: lastOrder } = await this.supabase
        .from('orders')
        .select('shopify_order_id, created_at')
        .eq('store_id', integration.store_id)
        .not('shopify_order_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Buscar órdenes nuevas desde la última sincronización
      const sinceId = lastOrder?.shopify_order_id || null;
      const createdAtMin = lastOrder?.created_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // últimas 24 horas por defecto

      logger.info('BACKEND', `📥 [RECONCILIATION] Fetching orders since: ${createdAtMin}`);

      const { orders } = await shopifyClient.getOrders({
        limit: 50, // Fetch max 50 orders per reconciliation
        created_at_min: createdAtMin,
        status: 'any',
      });

      let synced = 0;

      for (const order of orders) {
        // Verificar si la orden ya existe
        const { data: existingOrder } = await this.supabase
          .from('orders')
          .select('id')
          .eq('shopify_order_id', order.id)
          .eq('store_id', integration.store_id)
          .single();

        if (!existingOrder) {
          // Orden no existe - crear usando el webhook service
          logger.info('BACKEND', `➕ [RECONCILIATION] Syncing missing order: ${order.order_number}`);

          const result = await webhookService.processOrderCreatedWebhook(
            order,
            integration.store_id,
            integration.id
          );

          if (result.success) {
            synced++;
          } else {
            logger.error('BACKEND', `❌ [RECONCILIATION] Error al sincronizar pedido ${order.order_number}:`, result.error);
          }
        }
      }

      logger.info('BACKEND', `✅ [RECONCILIATION] Synced ${synced} orders for ${integration.shop_domain}`);
      return { synced };

    } catch (error: any) {
      logger.error('BACKEND', `❌ [RECONCILIATION] Error reconciling orders:`, error);
      return { synced: 0 };
    }
  }

  /**
   * Reconciliar productos desactualizados
   */
  private async reconcileProducts(integration: any): Promise<{ synced: number }> {
    try {
      const shopifyClient = new ShopifyClientService(integration);
      const webhookService = new ShopifyWebhookService(this.supabase);

      // Obtener productos que no se han actualizado en las últimas 24 horas
      const { data: staleProducts } = await this.supabase
        .from('products')
        .select('shopify_product_id')
        .eq('store_id', integration.store_id)
        .not('shopify_product_id', 'is', null)
        .lt('last_synced_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(20); // Máximo 20 productos por reconciliación

      if (!staleProducts || staleProducts.length === 0) {
        return { synced: 0 };
      }

      logger.info('BACKEND', `📦 [RECONCILIATION] Found ${staleProducts.length} stale products`);

      let synced = 0;

      for (const product of staleProducts) {
        try {
          // Obtener producto actualizado de Shopify
          const shopifyProduct = await shopifyClient.getProduct(product.shopify_product_id);

          // Actualizar usando webhook service
          const result = await webhookService.processProductUpdatedWebhook(
            shopifyProduct,
            integration.store_id,
            integration.id
          );

          if (result.success) {
            synced++;
          }

        } catch (error: any) {
          logger.error('BACKEND', `❌ [RECONCILIATION] Error syncing product ${product.shopify_product_id}:`, error);
        }
      }

      logger.info('BACKEND', `✅ [RECONCILIATION] Synced ${synced} products for ${integration.shop_domain}`);
      return { synced };

    } catch (error: any) {
      logger.error('BACKEND', `❌ [RECONCILIATION] Error reconciling products:`, error);
      return { synced: 0 };
    }
  }

  /**
   * Reconciliar clientes desactualizados
   */
  private async reconcileCustomers(integration: any): Promise<{ synced: number }> {
    try {
      // Por ahora solo retornamos 0
      // En el futuro se puede implementar lógica similar a productos
      return { synced: 0 };
    } catch (error: any) {
      logger.error('BACKEND', `❌ [RECONCILIATION] Error reconciling customers:`, error);
      return { synced: 0 };
    }
  }

  /**
   * Detectar gaps en la sincronización de órdenes
   * Útil para identificar problemas de webhooks
   */
  async detectOrderGaps(integration: any): Promise<{
    has_gaps: boolean;
    gaps: Array<{ start: string; end: string; missing_count: number }>;
  }> {
    try {
      // Obtener órdenes del último mes
      const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const { data: orders } = await this.supabase
        .from('orders')
        .select('shopify_order_number, created_at')
        .eq('store_id', integration.store_id)
        .not('shopify_order_id', 'is', null)
        .gte('created_at', oneMonthAgo.toISOString())
        .order('shopify_order_number', { ascending: true });

      if (!orders || orders.length < 2) {
        return { has_gaps: false, gaps: [] };
      }

      // Detectar gaps en números de orden (simplificado)
      // En producción, esto sería más sofisticado
      const gaps: Array<{ start: string; end: string; missing_count: number }> = [];

      for (let i = 0; i < orders.length - 1; i++) {
        const current = parseInt(orders[i].shopify_order_number, 10);
        const next = parseInt(orders[i + 1].shopify_order_number, 10);

        if (!isNaN(current) && !isNaN(next) && next - current > 1) {
          gaps.push({
            start: orders[i].shopify_order_number,
            end: orders[i + 1].shopify_order_number,
            missing_count: next - current - 1,
          });
        }
      }

      if (gaps.length > 0) {
        logger.warn('BACKEND', `⚠️ [RECONCILIATION] Detected ${gaps.length} gaps in order sequence for ${integration.shop_domain}`);
        logger.warn('BACKEND', '⚠️ [RECONCILIATION] Gaps:', gaps);
      }

      return {
        has_gaps: gaps.length > 0,
        gaps,
      };

    } catch (error: any) {
      logger.error('BACKEND', `❌ [RECONCILIATION] Error detecting gaps:`, error);
      return { has_gaps: false, gaps: [] };
    }
  }
}

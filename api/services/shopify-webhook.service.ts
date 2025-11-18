// Shopify Webhook Service
// Procesa webhooks de pedidos de Shopify y los envia a n8n para confirmacion automatica

import { SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import crypto from 'crypto';
import { ShopifyOrder } from '../types/shopify';

export class ShopifyWebhookService {
  private supabaseAdmin: SupabaseClient;
  private n8nWebhookUrl: string;

  constructor(supabase: SupabaseClient) {
    this.supabaseAdmin = supabase;
    this.n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || '';
  }

  // Verificar firma HMAC del webhook de Shopify
  static verifyHmacSignature(body: string, hmacHeader: string, secret: string): boolean {
    try {
      const hash = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest('base64');

      return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(hmacHeader)
      );
    } catch (error) {
      console.error('Error verificando HMAC:', error);
      return false;
    }
  }

  // Procesar webhook de pedido creado
  async processOrderCreatedWebhook(
    shopifyOrder: ShopifyOrder,
    storeId: string,
    integrationId: string
  ): Promise<{ success: boolean; order_id?: string; error?: string }> {
    try {
      // Registrar evento de webhook
      await this.logWebhookEvent({
        integration_id: integrationId,
        store_id: storeId,
        event_type: 'order',
        shopify_topic: 'orders/create',
        shopify_event_id: shopifyOrder.id.toString(),
        payload: shopifyOrder
      });

      // Verificar si el pedido ya existe en la base de datos
      const { data: existingOrder } = await this.supabaseAdmin
        .from('orders')
        .select('id')
        .eq('shopify_order_id', shopifyOrder.id.toString())
        .eq('store_id', storeId)
        .single();

      if (existingOrder) {
        console.log(`Pedido ${shopifyOrder.id} ya existe, omitiendo`);
        return { success: true, order_id: existingOrder.id };
      }

      // Mapear pedido de Shopify a formato local
      const orderData = this.mapShopifyOrderToLocal(shopifyOrder, storeId);

      // Insertar pedido en la base de datos
      const { data: newOrder, error: insertError } = await this.supabaseAdmin
        .from('orders')
        .insert(orderData)
        .select('id')
        .single();

      if (insertError) {
        throw new Error(`Error insertando pedido: ${insertError.message}`);
      }

      // Marcar webhook como procesado
      await this.markWebhookProcessed(shopifyOrder.id.toString(), storeId);

      // Enviar pedido a n8n para confirmación automática
      await this.sendOrderToN8n(newOrder.id, shopifyOrder, storeId);

      return { success: true, order_id: newOrder.id };

    } catch (error: any) {
      console.error('Error procesando webhook de pedido:', error);

      // Registrar error en el evento de webhook
      await this.logWebhookError(
        shopifyOrder.id.toString(),
        storeId,
        error.message
      );

      return {
        success: false,
        error: error.message || 'Error procesando webhook'
      };
    }
  }

  // Procesar webhook de producto eliminado
  async processProductDeletedWebhook(
    productId: number,
    storeId: string,
    integrationId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Registrar evento de webhook
      await this.logWebhookEvent({
        integration_id: integrationId,
        store_id: storeId,
        event_type: 'product',
        shopify_topic: 'products/delete',
        shopify_event_id: productId.toString(),
        payload: { id: productId }
      });

      // Eliminar producto de la base de datos local
      const { error: deleteError } = await this.supabaseAdmin
        .from('products')
        .delete()
        .eq('shopify_product_id', productId.toString())
        .eq('store_id', storeId);

      if (deleteError) {
        throw new Error(`Error eliminando producto: ${deleteError.message}`);
      }

      // Marcar webhook como procesado
      await this.markWebhookProcessed(productId.toString(), storeId);

      console.log(`Producto ${productId} eliminado del dashboard por webhook de Shopify`);

      return { success: true };

    } catch (error: any) {
      console.error('Error procesando eliminación de producto:', error);

      await this.logWebhookError(
        productId.toString(),
        storeId,
        error.message
      );

      return {
        success: false,
        error: error.message || 'Error procesando webhook'
      };
    }
  }

  // Procesar webhook de pedido actualizado
  async processOrderUpdatedWebhook(
    shopifyOrder: ShopifyOrder,
    storeId: string,
    integrationId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Registrar evento de webhook
      await this.logWebhookEvent({
        integration_id: integrationId,
        store_id: storeId,
        event_type: 'order',
        shopify_topic: 'orders/updated',
        shopify_event_id: shopifyOrder.id.toString(),
        payload: shopifyOrder
      });

      // Actualizar pedido existente
      const orderData = this.mapShopifyOrderToLocal(shopifyOrder, storeId);

      const { error: updateError } = await this.supabaseAdmin
        .from('orders')
        .update(orderData)
        .eq('shopify_order_id', shopifyOrder.id.toString())
        .eq('store_id', storeId);

      if (updateError) {
        throw new Error(`Error actualizando pedido: ${updateError.message}`);
      }

      // Marcar webhook como procesado
      await this.markWebhookProcessed(shopifyOrder.id.toString(), storeId);

      return { success: true };

    } catch (error: any) {
      console.error('Error procesando actualización de pedido:', error);

      await this.logWebhookError(
        shopifyOrder.id.toString(),
        storeId,
        error.message
      );

      return {
        success: false,
        error: error.message || 'Error procesando webhook'
      };
    }
  }

  // Mapear pedido de Shopify a formato local
  private mapShopifyOrderToLocal(shopifyOrder: ShopifyOrder, storeId: string): any {
    const customerName = shopifyOrder.customer
      ? `${shopifyOrder.customer.first_name} ${shopifyOrder.customer.last_name}`.trim()
      : shopifyOrder.billing_address
      ? `${shopifyOrder.billing_address.first_name} ${shopifyOrder.billing_address.last_name}`.trim()
      : 'Cliente desconocido';

    const products = shopifyOrder.line_items
      .map(item => item.title)
      .join(', ');

    const quantity = shopifyOrder.line_items
      .reduce((sum, item) => sum + item.quantity, 0);

    return {
      store_id: storeId,
      shopify_order_id: shopifyOrder.id.toString(),
      shopify_order_number: shopifyOrder.order_number.toString(),
      customer: customerName,
      email: shopifyOrder.email || shopifyOrder.customer?.email || '',
      phone: shopifyOrder.phone || shopifyOrder.customer?.phone || '',
      product: products,
      quantity: quantity,
      total: parseFloat(shopifyOrder.total_price),
      status: this.mapShopifyOrderStatus(shopifyOrder.financial_status, shopifyOrder.fulfillment_status),
      date: shopifyOrder.created_at,
      shipping_address: shopifyOrder.shipping_address?.address1 || '',
      shipping_city: shopifyOrder.shipping_address?.city || '',
      shipping_state: shopifyOrder.shipping_address?.province || '',
      shipping_postal_code: shopifyOrder.shipping_address?.zip || '',
      shipping_country: shopifyOrder.shipping_address?.country || '',
      notes: shopifyOrder.note || '',
      shopify_data: shopifyOrder,
      last_synced_at: new Date().toISOString(),
      sync_status: 'synced',
      confirmed_by_whatsapp: false
    };
  }

  // Mapear estado de pedido de Shopify a estado interno
  private mapShopifyOrderStatus(
    financialStatus: string,
    fulfillmentStatus: string | null
  ): string {
    if (fulfillmentStatus === 'fulfilled') return 'delivered';
    if (financialStatus === 'refunded') return 'cancelled';
    if (financialStatus === 'paid' && !fulfillmentStatus) return 'confirmed';
    if (financialStatus === 'paid' && fulfillmentStatus === 'partial') return 'in_transit';
    return 'pending';
  }

  // Enviar pedido a n8n para confirmación automática
  private async sendOrderToN8n(
    orderId: string,
    shopifyOrder: ShopifyOrder,
    storeId: string
  ): Promise<void> {
    if (!this.n8nWebhookUrl) {
      console.warn('URL de webhook de n8n no configurada, omitiendo envío');
      return;
    }

    try {
      // Obtener datos completos del pedido de la base de datos
      const { data: order, error } = await this.supabaseAdmin
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (error || !order) {
        throw new Error('No se pudo obtener el pedido de la base de datos');
      }

      // Preparar payload para n8n
      const n8nPayload = {
        order_id: orderId,
        store_id: storeId,
        shopify_order_id: shopifyOrder.id.toString(),
        shopify_order_number: shopifyOrder.order_number,
        customer_name: order.customer,
        customer_email: order.email,
        customer_phone: order.phone,
        total: order.total,
        products: order.product,
        quantity: order.quantity,
        shipping_address: {
          address: order.shipping_address,
          city: order.shipping_city,
          state: order.shipping_state,
          postal_code: order.shipping_postal_code,
          country: order.shipping_country
        },
        order_date: order.date,
        status: order.status,
        notes: order.notes,
        shopify_data: shopifyOrder
      };

      // Crear firma HMAC para autenticación
      const n8nSecret = process.env.N8N_WEBHOOK_SECRET || process.env.N8N_API_KEY || '';
      const signature = crypto
        .createHmac('sha256', n8nSecret)
        .update(JSON.stringify(n8nPayload))
        .digest('hex');

      // Enviar a n8n con autenticación
      const response = await axios.post(this.n8nWebhookUrl, n8nPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.N8N_API_KEY || '',
          'X-Signature': signature,
          'X-Timestamp': new Date().toISOString()
        },
        timeout: 30000
      });

      console.log(`Pedido ${orderId} enviado a n8n exitosamente:`, response.status);

      // Registrar envío exitoso
      await this.supabaseAdmin
        .from('orders')
        .update({
          n8n_sent: true,
          n8n_sent_at: new Date().toISOString()
        })
        .eq('id', orderId);

    } catch (error: any) {
      console.error('Error enviando pedido a n8n:', error);

      // Registrar error pero no fallar el proceso principal
      await this.supabaseAdmin
        .from('orders')
        .update({
          n8n_error: error.message,
          n8n_retry_count: 0
        })
        .eq('id', orderId);
    }
  }

  // Registrar evento de webhook en la base de datos
  private async logWebhookEvent(eventData: {
    integration_id: string;
    store_id: string;
    event_type: string;
    shopify_topic: string;
    shopify_event_id: string;
    payload: any;
  }): Promise<void> {
    await this.supabaseAdmin
      .from('shopify_webhook_events')
      .insert({
        integration_id: eventData.integration_id,
        store_id: eventData.store_id,
        event_type: eventData.event_type,
        shopify_topic: eventData.shopify_topic,
        shopify_event_id: eventData.shopify_event_id,
        payload: eventData.payload,
        processed: false
      });
  }

  // Marcar webhook como procesado
  private async markWebhookProcessed(shopifyEventId: string, storeId: string): Promise<void> {
    await this.supabaseAdmin
      .from('shopify_webhook_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString()
      })
      .eq('shopify_event_id', shopifyEventId)
      .eq('store_id', storeId);
  }

  // Registrar error en el procesamiento de webhook
  private async logWebhookError(
    shopifyEventId: string,
    storeId: string,
    errorMessage: string
  ): Promise<void> {
    await this.supabaseAdmin
      .from('shopify_webhook_events')
      .update({
        processing_error: errorMessage,
        retry_count: this.supabaseAdmin.sql`retry_count + 1`
      })
      .eq('shopify_event_id', shopifyEventId)
      .eq('store_id', storeId);
  }

  // Reintentar webhooks fallidos
  async retryFailedWebhooks(maxRetries: number = 3): Promise<void> {
    const { data: failedEvents, error } = await this.supabaseAdmin
      .from('shopify_webhook_events')
      .select('*')
      .eq('processed', false)
      .lt('retry_count', maxRetries)
      .order('created_at', { ascending: true })
      .limit(10);

    if (error || !failedEvents || failedEvents.length === 0) {
      return;
    }

    console.log(`Reintentando ${failedEvents.length} webhooks fallidos`);

    for (const event of failedEvents) {
      try {
        if (event.shopify_topic === 'orders/create') {
          await this.processOrderCreatedWebhook(
            event.payload,
            event.store_id,
            event.integration_id
          );
        } else if (event.shopify_topic === 'orders/updated') {
          await this.processOrderUpdatedWebhook(
            event.payload,
            event.store_id,
            event.integration_id
          );
        }
      } catch (error) {
        console.error(`Error reintentando webhook ${event.id}:`, error);
      }

      // Pausa entre reintentos
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// ================================================================
// EXTERNAL WEBHOOK SERVICE
// ================================================================
// Procesa pedidos recibidos desde sistemas externos (landing pages, etc.)
// Incluye: autenticación por API Key, creación de clientes, y órdenes
// ================================================================

import { logger } from '../utils/logger';
import crypto from 'crypto';
import { supabaseAdmin } from '../db/connection';
import { sanitizeSearchInput } from '../utils/sanitize';

// ================================================================
// TYPES
// ================================================================

export interface ExternalOrderPayload {
  idempotency_key?: string;

  customer: {
    name: string;
    email?: string;
    phone?: string;
  };

  shipping_address: {
    address?: string;
    city?: string;
    country?: string;
    reference?: string;
    notes?: string;
    google_maps_url?: string;
  };

  items: Array<{
    name: string;
    sku?: string;
    quantity: number;
    price: number;
    variant_title?: string;
    variant_type?: 'bundle' | 'variation'; // Migration 101: Explicit type for bundles vs variations
  }>;

  totals: {
    subtotal?: number;
    shipping?: number;
    discount?: number;
    tax?: number;
    total: number;
  };

  payment_method: 'cash_on_delivery' | 'online' | 'pending';

  metadata?: Record<string, any>;
}

export interface WebhookConfig {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  api_key: string;
  api_key_prefix: string;
  is_active: boolean;
  auto_confirm_orders: boolean;
  default_currency: string;
  total_orders_received: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookLog {
  id: string;
  config_id: string;
  store_id: string;
  request_id: string | null;
  source_ip: string | null;
  user_agent: string | null;
  payload: any;
  headers: any;
  status: 'pending' | 'success' | 'failed' | 'duplicate' | 'validation_error';
  order_id: string | null;
  customer_id: string | null;
  error_message: string | null;
  error_details: any;
  processing_time_ms: number | null;
  created_at: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

// ================================================================
// EXTERNAL WEBHOOK SERVICE CLASS
// ================================================================

export class ExternalWebhookService {

  // ================================================================
  // API KEY GENERATION
  // ================================================================

  /**
   * Genera un nuevo API Key seguro
   * Formato: wh_ + 30 bytes hex = 63 caracteres total (cabe en VARCHAR(64))
   * Prefix: 12 caracteres max (cabe en VARCHAR(12))
   */
  static generateApiKey(): { key: string; prefix: string } {
    const randomBytes = crypto.randomBytes(30).toString('hex'); // 60 chars hex
    const key = `wh_${randomBytes}`; // 63 chars total
    const prefix = key.substring(0, 8) + '...'; // 11 chars total
    return { key, prefix };
  }

  // ================================================================
  // API KEY HASHING
  // ================================================================

  /**
   * Hashes an API key using SHA-256 before storing or comparing
   */
  private hashApiKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  // ================================================================
  // API KEY VALIDATION
  // ================================================================

  /**
   * Valida el API Key y retorna la configuración del webhook si es válido
   */
  async validateApiKey(storeId: string, apiKey: string): Promise<WebhookConfig | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('external_webhook_configs')
        .select('*')
        .eq('store_id', storeId)
        .eq('api_key', this.hashApiKey(apiKey))
        .eq('is_active', true)
        .single();

      if (error || !data) {
        logger.info('BACKEND', `❌ [ExternalWebhook] Invalid API key for store ${storeId}`);
        return null;
      }

      return data as WebhookConfig;
    } catch (error) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error validating API key:', error);
      return null;
    }
  }

  // ================================================================
  // IDEMPOTENCY
  // ================================================================

  /**
   * Genera una clave de idempotency a partir del payload si no se proporciona una
   */
  generateIdempotencyKey(payload: ExternalOrderPayload): string {
    if (payload.idempotency_key) {
      return payload.idempotency_key;
    }

    // Generar hash basado en datos únicos del pedido
    const uniqueData = JSON.stringify({
      customer: payload.customer,
      items: payload.items,
      total: payload.totals.total,
      timestamp: Math.floor(Date.now() / 1000) // Agrupar por segundo (no minuto - evita deduplicación incorrecta)
    });

    return crypto.createHash('md5').update(uniqueData).digest('hex');
  }

  /**
   * Verifica si ya se procesó un pedido con esta clave de idempotency
   */
  async checkIdempotency(configId: string, idempotencyKey: string): Promise<{ isDuplicate: boolean; orderId?: string }> {
    try {
      const { data, error } = await supabaseAdmin
        .from('external_webhook_idempotency')
        .select('order_id')
        .eq('config_id', configId)
        .eq('idempotency_key', idempotencyKey)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (error || !data) {
        return { isDuplicate: false };
      }

      return { isDuplicate: true, orderId: data.order_id };
    } catch (error) {
      return { isDuplicate: false };
    }
  }

  /**
   * Registra una clave de idempotency procesada (TTL 24 horas)
   */
  async recordIdempotency(configId: string, idempotencyKey: string, orderId: string): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await supabaseAdmin
        .from('external_webhook_idempotency')
        .insert({
          config_id: configId,
          idempotency_key: idempotencyKey,
          order_id: orderId,
          expires_at: expiresAt.toISOString()
        });
    } catch (error) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error recording idempotency:', error);
    }
  }

  // ================================================================
  // PAYLOAD VALIDATION
  // ================================================================

  /**
   * Valida el payload del pedido
   */
  validatePayload(payload: any): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    // Customer validation
    if (!payload.customer) {
      errors.push({ field: 'customer', message: 'Customer object is required' });
    } else {
      if (!payload.customer.name || payload.customer.name.trim() === '') {
        errors.push({ field: 'customer.name', message: 'Customer name is required' });
      }
      if (!payload.customer.email && !payload.customer.phone) {
        errors.push({ field: 'customer.email/phone', message: 'Either email or phone is required' });
      }
    }

    // Shipping address validation
    // Requiere: (address + city) O google_maps_url
    if (!payload.shipping_address) {
      errors.push({ field: 'shipping_address', message: 'Shipping address is required' });
    } else {
      const hasManualAddress = payload.shipping_address.address && payload.shipping_address.address.trim() !== '';
      const hasCity = payload.shipping_address.city && payload.shipping_address.city.trim() !== '';
      const hasGoogleMapsUrl = payload.shipping_address.google_maps_url && payload.shipping_address.google_maps_url.trim() !== '';

      // Validar que tenga dirección manual completa O google_maps_url
      if (!hasGoogleMapsUrl) {
        // Sin Google Maps URL, requiere address + city
        if (!hasManualAddress) {
          errors.push({ field: 'shipping_address.address', message: 'Address is required (or provide google_maps_url)' });
        }
        if (!hasCity) {
          errors.push({ field: 'shipping_address.city', message: 'City is required (or provide google_maps_url)' });
        }
      } else {
        // Validar formato de Google Maps URL
        const validGoogleMapsPatterns = [
          /^https?:\/\/(www\.)?google\.[a-z.]+\/maps/i,
          /^https?:\/\/maps\.google\.[a-z.]+/i,
          /^https?:\/\/goo\.gl\/maps/i,
          /^https?:\/\/maps\.app\.goo\.gl/i
        ];
        const isValidGoogleMapsUrl = validGoogleMapsPatterns.some(pattern =>
          pattern.test(payload.shipping_address.google_maps_url!)
        );
        if (!isValidGoogleMapsUrl) {
          errors.push({ field: 'shipping_address.google_maps_url', message: 'Invalid Google Maps URL format' });
        }
      }
    }

    // Items validation
    if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      errors.push({ field: 'items', message: 'At least one item is required' });
    } else {
      payload.items.forEach((item: any, index: number) => {
        if (!item.name || item.name.trim() === '') {
          errors.push({ field: `items[${index}].name`, message: 'Item name is required' });
        }
        if (typeof item.quantity !== 'number' || item.quantity < 1) {
          errors.push({ field: `items[${index}].quantity`, message: 'Item quantity must be at least 1' });
        }
        if (typeof item.price !== 'number' || item.price < 0) {
          errors.push({ field: `items[${index}].price`, message: 'Item price must be a positive number' });
        }
      });
    }

    // Totals validation
    if (!payload.totals) {
      errors.push({ field: 'totals', message: 'Totals object is required' });
    } else {
      if (typeof payload.totals.total !== 'number' || payload.totals.total < 0) {
        errors.push({ field: 'totals.total', message: 'Total must be a positive number' });
      }
    }

    // Payment method validation
    const validPaymentMethods = ['cash_on_delivery', 'online', 'pending'];
    if (!payload.payment_method || !validPaymentMethods.includes(payload.payment_method)) {
      errors.push({ field: 'payment_method', message: 'Payment method must be one of: cash_on_delivery, online, pending' });
    }

    return { valid: errors.length === 0, errors };
  }

  // ================================================================
  // CUSTOMER MANAGEMENT
  // ================================================================

  /**
   * Busca un cliente existente o crea uno nuevo
   * Prioridad: email > phone
   */
  async findOrCreateCustomer(
    customerData: ExternalOrderPayload['customer'],
    shippingAddress: ExternalOrderPayload['shipping_address'],
    storeId: string
  ): Promise<{ customerId: string; isNew: boolean }> {
    try {
      // 1. Buscar por email
      if (customerData.email) {
        const { data: byEmail } = await supabaseAdmin
          .from('customers')
          .select('id')
          .eq('store_id', storeId)
          .eq('email', customerData.email)
          .single();

        if (byEmail) {
          logger.info('BACKEND', `✅ [ExternalWebhook] Found existing customer by email: ${customerData.email}`);
          return { customerId: byEmail.id, isNew: false };
        }
      }

      // 2. Buscar por teléfono
      if (customerData.phone) {
        const normalizedPhone = this.normalizePhone(customerData.phone);
        const { data: byPhone } = await supabaseAdmin
          .from('customers')
          .select('id')
          .eq('store_id', storeId)
          .eq('phone', normalizedPhone)
          .single();

        if (byPhone) {
          logger.info('BACKEND', `✅ [ExternalWebhook] Found existing customer by phone: ${normalizedPhone}`);
          return { customerId: byPhone.id, isNew: false };
        }
      }

      // 3. Crear nuevo cliente
      // Si solo hay google_maps_url, guardar el link como referencia
      const hasGoogleMapsOnly = shippingAddress.google_maps_url &&
        (!shippingAddress.address || shippingAddress.address.trim() === '');

      const newCustomer = {
        store_id: storeId,
        name: customerData.name,
        email: customerData.email || null,
        phone: customerData.phone ? this.normalizePhone(customerData.phone) : null,
        address: hasGoogleMapsOnly ? 'Ver ubicación en Google Maps' : shippingAddress.address,
        city: shippingAddress.city || (hasGoogleMapsOnly ? 'Ver en mapa' : null),
        country: shippingAddress.country || 'Paraguay',
        notes: shippingAddress.google_maps_url
          ? `Google Maps: ${shippingAddress.google_maps_url}${shippingAddress.reference ? ` | ${shippingAddress.reference}` : ''}`
          : (shippingAddress.reference || null),
        source: 'webhook_externo',
        total_orders: 1,
        total_spent: 0
      };

      const { data: created, error } = await supabaseAdmin
        .from('customers')
        .insert(newCustomer)
        .select('id')
        .single();

      if (error) {
        logger.error('BACKEND', '❌ [ExternalWebhook] Error creating customer:', error);
        throw new Error(`Error al crear cliente: ${error.message}`);
      }

      logger.info('BACKEND', `✅ [ExternalWebhook] Created new customer: ${created.id}`);
      return { customerId: created.id, isNew: true };
    } catch (error) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error in findOrCreateCustomer:', error);
      throw error;
    }
  }

  /**
   * Normaliza el formato del teléfono
   */
  private normalizePhone(phone: string): string {
    // Eliminar espacios y caracteres especiales excepto +
    return phone.replace(/[^\d+]/g, '');
  }

  // ================================================================
  // ORDER CREATION
  // ================================================================

  /**
   * Genera un número de orden único
   */
  private async generateOrderNumber(storeId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('order_number')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let nextNumber = 1;
    if (data?.order_number) {
      const match = data.order_number.match(/ORD-(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    return `ORD-${nextNumber.toString().padStart(5, '0')}`;
  }

  /**
   * Procesa un pedido entrante y lo guarda en la base de datos
   */
  async processIncomingOrder(
    payload: ExternalOrderPayload,
    storeId: string,
    config: WebhookConfig,
    requestInfo: { sourceIp?: string; userAgent?: string }
  ): Promise<{ success: boolean; orderId?: string; orderNumber?: string; customerId?: string; error?: string; isDuplicate?: boolean }> {
    const startTime = Date.now();
    let logId: string | null = null;

    try {
      // 1. Generar idempotency key
      const idempotencyKey = this.generateIdempotencyKey(payload);

      // 2. Crear log de la petición
      const { data: log } = await supabaseAdmin
        .from('external_webhook_logs')
        .insert({
          config_id: config.id,
          store_id: storeId,
          request_id: idempotencyKey,
          source_ip: requestInfo.sourceIp || null,
          user_agent: requestInfo.userAgent || null,
          payload: payload,
          headers: null,
          status: 'pending'
        })
        .select('id')
        .single();

      logId = log?.id || null;

      // 3. Verificar idempotency
      const idempotencyCheck = await this.checkIdempotency(config.id, idempotencyKey);
      if (idempotencyCheck.isDuplicate) {
        logger.info('BACKEND', `⚠️ [ExternalWebhook] Duplicate order detected: ${idempotencyKey}`);

        // Actualizar log
        if (logId) {
          await this.updateLogStatus(logId, 'duplicate', idempotencyCheck.orderId, null, Date.now() - startTime);
        }

        return {
          success: true,
          isDuplicate: true,
          orderId: idempotencyCheck.orderId
        };
      }

      // 4. Validar payload
      const validation = this.validatePayload(payload);
      if (!validation.valid) {
        logger.info('BACKEND', `❌ [ExternalWebhook] Validation failed:`, validation.errors);

        // Actualizar log
        if (logId) {
          await supabaseAdmin
            .from('external_webhook_logs')
            .update({
              status: 'validation_error',
              error_message: 'Payload validation failed',
              error_details: validation.errors,
              processing_time_ms: Date.now() - startTime
            })
            .eq('id', logId);
        }

        return {
          success: false,
          error: 'validation_error'
        };
      }

      // 5. Buscar o crear cliente
      const { customerId, isNew: isNewCustomer } = await this.findOrCreateCustomer(
        payload.customer,
        payload.shipping_address,
        storeId
      );

      // 6. Generar número de orden
      const orderNumber = await this.generateOrderNumber(storeId);

      // 7. Construir objeto de orden
      const orderStatus = config.auto_confirm_orders ? 'confirmed' : 'pending';

      // Construir line_items JSONB
      const lineItems = payload.items.map(item => ({
        name: item.name,
        sku: item.sku || null,
        quantity: item.quantity,
        price: item.price,
        variant_title: item.variant_title || null
      }));

      // Construir shipping_address JSONB
      // Sanitize Google Maps URL: must be non-empty string. Treat whitespace as null.
      let sanitizedMapsUrl: string | null | undefined = payload.shipping_address.google_maps_url;
      if (sanitizedMapsUrl && sanitizedMapsUrl.trim() === '') {
        sanitizedMapsUrl = null;
      }

      // Si solo hay google_maps_url, usar "Ver ubicación en Google Maps" como address
      const hasManualAddress = payload.shipping_address.address && payload.shipping_address.address.trim() !== '';
      // Only default to "Ver ubicación..." if we have a valid Maps URL AND NO manual address
      const hasGoogleMapsOnly = !!sanitizedMapsUrl && !hasManualAddress;

      const shippingAddressJson = {
        address1: hasGoogleMapsOnly
          ? 'Ver ubicación en Google Maps'
          : payload.shipping_address.address,
        city: payload.shipping_address.city || 'Ver en mapa',
        country: payload.shipping_address.country || 'Paraguay',
        reference: payload.shipping_address.reference || null,
        notes: payload.shipping_address.notes || null,
        google_maps_url: sanitizedMapsUrl || null
      };

      const orderData = {
        store_id: storeId,
        customer_id: customerId,
        order_number: orderNumber,
        external_order_id: payload.idempotency_key || idempotencyKey,
        source: 'webhook_externo',

        // Customer info (denormalized)
        customer_name: payload.customer.name,
        customer_first_name: payload.customer.name.trim().split(' ')[0] || 'Cliente',
        customer_last_name: payload.customer.name.trim().split(' ').slice(1).join(' ') || '',
        customer_email: payload.customer.email || null,
        customer_phone: payload.customer.phone || null,

        // Shipping - customer_address es el campo denormalizado que se muestra en la UI
        shipping_address: shippingAddressJson,
        customer_address: hasGoogleMapsOnly
          ? 'Ver ubicación en Google Maps'
          : (payload.shipping_address.address || ''),
        address_reference: payload.shipping_address.reference || null,
        delivery_notes: payload.shipping_address.notes || null,
        google_maps_link: sanitizedMapsUrl || null,

        // Products
        line_items: lineItems,

        // Totals
        subtotal_price: payload.totals.subtotal || payload.totals.total,
        total_shipping: payload.totals.shipping || 0,
        total_discounts: payload.totals.discount || 0,
        total_tax: payload.totals.tax || 0,
        total_price: payload.totals.total,
        currency: config.default_currency || 'PYG',

        // Payment
        payment_method: payload.payment_method === 'cash_on_delivery' ? 'cod' : payload.payment_method,
        financial_status: payload.payment_method === 'online' ? 'paid' : 'pending',
        cod_amount: payload.payment_method === 'cash_on_delivery' ? payload.totals.total : 0,

        // Status
        sleeves_status: orderStatus,

        // Metadata
        notes: payload.metadata ? JSON.stringify(payload.metadata) : null
      };

      // 8. Insertar orden
      const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert(orderData)
        .select('id, order_number')
        .single();

      if (orderError) {
        logger.error('BACKEND', '❌ [ExternalWebhook] Error creating order:', orderError);

        // Actualizar log
        if (logId) {
          await this.updateLogStatus(logId, 'failed', null, orderError.message, Date.now() - startTime);
        }

        return {
          success: false,
          error: `Error al crear pedido: ${orderError.message}`
        };
      }

      // 8.5 Crear order_line_items para tracking de inventario
      // Intentar mapear SKU a productos/variantes
      // Migration 101: Include variant_type for bundle vs variation tracking
      const orderLineItems = [];
      for (const item of payload.items) {
        let productId: string | null = null;
        let variantId: string | null = null;
        let variantType: string | null = item.variant_type || null; // Accept from payload for external control

        // Buscar producto o variante por SKU
        if (item.sku) {
          try {
            const { data: match } = await supabaseAdmin
              .rpc('find_product_or_variant_by_sku', {
                p_store_id: storeId,
                p_sku: item.sku
              });

            if (match && match.length > 0) {
              const result = match[0];
              productId = result.product_id;
              variantId = result.variant_id;
              logger.info('BACKEND', `✅ [ExternalWebhook] SKU "${item.sku}" mapped to ${result.entity_type}: ${result.variant_id || result.product_id}`);
            } else {
              logger.info('BACKEND', `⚠️ [ExternalWebhook] SKU "${item.sku}" not found in inventory - order will be created without stock tracking`);
            }
          } catch (rpcErr: any) {
            logger.warn('BACKEND', `[ExternalWebhook] RPC find_product_or_variant_by_sku not available, trying fallback`);

            // Fallback: Try variant first, then product
            // Migration 101: Also fetch variant_type and uses_shared_stock
            const { data: variantMatch } = await supabaseAdmin
              .from('product_variants')
              .select('id, product_id, variant_type, uses_shared_stock')
              .eq('store_id', storeId)
              .ilike('sku', item.sku)
              .eq('is_active', true)
              .maybeSingle();

            if (variantMatch) {
              productId = variantMatch.product_id;
              variantId = variantMatch.id;
              // Migration 101: Get variant_type from DB if not in payload
              if (!variantType) {
                variantType = variantMatch.variant_type || (variantMatch.uses_shared_stock ? 'bundle' : 'variation');
              }
              logger.info('BACKEND', `✅ [ExternalWebhook] Variant found by SKU: ${item.sku} (type: ${variantType})`);
            } else {
              const { data: productMatch } = await supabaseAdmin
                .from('products')
                .select('id')
                .eq('store_id', storeId)
                .ilike('sku', item.sku)
                .eq('is_active', true)
                .maybeSingle();

              if (productMatch) {
                productId = productMatch.id;
                // Products without variants default to null (no variant_type)
              }
            }
          }
        }

        orderLineItems.push({
          order_id: order.id,
          product_id: productId,
          variant_id: variantId,
          variant_type: variantType, // Migration 101: bundle vs variation for audit trail
          product_name: item.name,
          variant_title: item.variant_title || null,
          sku: item.sku || null,
          quantity: item.quantity,
          unit_price: item.price,
          total_price: item.price * item.quantity,
          stock_deducted: false
        });
      }

      // Insert order_line_items
      if (orderLineItems.length > 0) {
        const { error: lineItemsError } = await supabaseAdmin
          .from('order_line_items')
          .insert(orderLineItems);

        if (lineItemsError) {
          logger.warn('BACKEND', `[ExternalWebhook] Error creating order_line_items:`, lineItemsError.message);
          // Don't fail the order - line items are for inventory tracking
        } else {
          logger.info('BACKEND', `✅ [ExternalWebhook] Created ${orderLineItems.length} order_line_items for order ${order.order_number}`);
        }
      }

      // 9. Registrar idempotency
      await this.recordIdempotency(config.id, idempotencyKey, order.id);

      // 10. Actualizar log con éxito
      if (logId) {
        await supabaseAdmin
          .from('external_webhook_logs')
          .update({
            status: 'success',
            order_id: order.id,
            customer_id: customerId,
            processing_time_ms: Date.now() - startTime
          })
          .eq('id', logId);
      }

      logger.info('BACKEND', `✅ [ExternalWebhook] Order created successfully: ${order.order_number} (${order.id})`);

      return {
        success: true,
        orderId: order.id,
        orderNumber: order.order_number,
        customerId: customerId
      };

    } catch (error: any) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error processing order:', error);

      // Actualizar log con error
      if (logId) {
        await this.updateLogStatus(logId, 'failed', null, error.message, Date.now() - startTime);
      }

      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Actualiza el estado de un log
   */
  private async updateLogStatus(
    logId: string,
    status: string,
    orderId: string | null | undefined,
    errorMessage: string | null,
    processingTimeMs: number
  ): Promise<void> {
    try {
      await supabaseAdmin
        .from('external_webhook_logs')
        .update({
          status,
          order_id: orderId || null,
          error_message: errorMessage,
          processing_time_ms: processingTimeMs
        })
        .eq('id', logId);
    } catch (error) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error updating log status:', error);
    }
  }

  // ================================================================
  // CONFIGURATION MANAGEMENT
  // ================================================================

  /**
   * Obtiene la configuración del webhook para una tienda
   */
  async getConfig(storeId: string): Promise<WebhookConfig | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('external_webhook_configs')
        .select('*')
        .eq('store_id', storeId)
        .single();

      if (error || !data) {
        return null;
      }

      return data as WebhookConfig;
    } catch (error) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error getting config:', error);
      return null;
    }
  }

  /**
   * Crea una nueva configuración de webhook
   */
  async createConfig(
    storeId: string,
    userId: string,
    options?: { name?: string; description?: string; autoConfirm?: boolean }
  ): Promise<{ config: WebhookConfig; apiKey: string } | { error: string }> {
    try {
      // Verificar si ya existe
      const existing = await this.getConfig(storeId);
      if (existing) {
        return { error: 'Webhook configuration already exists for this store' };
      }

      // Generar API Key
      const { key: apiKey, prefix: apiKeyPrefix } = ExternalWebhookService.generateApiKey();

      const configData = {
        store_id: storeId,
        name: options?.name || 'Webhook Externo',
        description: options?.description || null,
        api_key: this.hashApiKey(apiKey), // Store hashed key, never plaintext
        api_key_prefix: apiKeyPrefix,
        is_active: true,
        auto_confirm_orders: options?.autoConfirm || false,
        created_by: userId
      };

      const { data, error } = await supabaseAdmin
        .from('external_webhook_configs')
        .insert(configData)
        .select('*')
        .single();

      if (error) {
        logger.error('BACKEND', '❌ [ExternalWebhook] Error creating config:', error);
        return { error: `Error al crear configuración de webhook: ${error.message}` };
      }

      logger.info('BACKEND', `✅ [ExternalWebhook] Created webhook config for store ${storeId}`);
      return { config: data as WebhookConfig, apiKey };
    } catch (error: any) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error creating config:', error);
      return { error: error.message || 'Unknown error' };
    }
  }

  /**
   * Regenera el API Key
   */
  async regenerateApiKey(storeId: string): Promise<{ apiKey: string } | { error: string }> {
    try {
      const { key: apiKey, prefix: apiKeyPrefix } = ExternalWebhookService.generateApiKey();

      const { error } = await supabaseAdmin
        .from('external_webhook_configs')
        .update({
          api_key: this.hashApiKey(apiKey), // Store hashed key, never plaintext
          api_key_prefix: apiKeyPrefix,
          updated_at: new Date().toISOString()
        })
        .eq('store_id', storeId);

      if (error) {
        return { error: `Error al regenerar clave API: ${error.message}` };
      }

      logger.info('BACKEND', `✅ [ExternalWebhook] Regenerated API key for store ${storeId}`);
      return { apiKey };
    } catch (error: any) {
      return { error: error.message || 'Unknown error' };
    }
  }

  /**
   * Desactiva el webhook
   */
  async disableWebhook(storeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabaseAdmin
        .from('external_webhook_configs')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('store_id', storeId);

      if (error) {
        return { success: false, error: error.message };
      }

      logger.info('BACKEND', `✅ [ExternalWebhook] Disabled webhook for store ${storeId}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Elimina la configuración del webhook
   */
  async deleteConfig(storeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabaseAdmin
        .from('external_webhook_configs')
        .delete()
        .eq('store_id', storeId);

      if (error) {
        return { success: false, error: error.message };
      }

      logger.info('BACKEND', `✅ [ExternalWebhook] Deleted webhook config for store ${storeId}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ================================================================
  // LOGS
  // ================================================================

  /**
   * Obtiene los logs de webhook paginados
   */
  async getLogs(
    storeId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ logs: WebhookLog[]; total: number; page: number; totalPages: number }> {
    try {
      const offset = (page - 1) * limit;

      // Obtener total
      const { count } = await supabaseAdmin
        .from('external_webhook_logs')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', storeId);

      // Obtener logs
      const { data, error } = await supabaseAdmin
        .from('external_webhook_logs')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        logger.error('BACKEND', '❌ [ExternalWebhook] Error getting logs:', error);
        return { logs: [], total: 0, page, totalPages: 0 };
      }

      const total = count || 0;
      const totalPages = Math.ceil(total / limit);

      return {
        logs: data as WebhookLog[],
        total,
        page,
        totalPages
      };
    } catch (error) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error getting logs:', error);
      return { logs: [], total: 0, page, totalPages: 0 };
    }
  }

  /**
   * Obtiene un log específico con todos los detalles
   */
  async getLogById(logId: string, storeId: string): Promise<WebhookLog | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('external_webhook_logs')
        .select('*')
        .eq('id', logId)
        .eq('store_id', storeId)
        .single();

      if (error || !data) {
        return null;
      }

      return data as WebhookLog;
    } catch (error) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error getting log:', error);
      return null;
    }
  }

  // ================================================================
  // ORDER LOOKUP (Public API)
  // ================================================================

  /**
   * Busca órdenes por teléfono, número de orden, o ID
   * Solo devuelve órdenes del store autenticado
   */
  async lookupOrders(
    storeId: string,
    filters: {
      phone?: string;
      order_number?: string;
      status?: string;
      limit?: number;
    }
  ): Promise<{ success: boolean; orders: any[]; total: number; error?: string }> {
    try {
      const limit = Math.min(Math.max(filters.limit || 20, 1), 100);

      // At least one filter required
      if (!filters.phone && !filters.order_number) {
        return { success: false, orders: [], total: 0, error: 'At least one filter required: phone or order_number' };
      }

      let query = supabaseAdmin
        .from('orders')
        .select(`
          id, order_number, shopify_order_name, shopify_order_number,
          customer_first_name, customer_last_name, customer_phone, customer_email,
          customer_address, shipping_address, delivery_zone, shipping_city,
          total_price, subtotal_price, total_shipping, total_discounts,
          cod_amount, payment_method, financial_status,
          sleeves_status, courier_id, is_pickup,
          delivery_preferences, delivery_notes,
          created_at, confirmed_at, delivered_at,
          line_items
        `, { count: 'exact' })
        .eq('store_id', storeId)
        .is('deleted_at', null);

      // Apply filters
      if (filters.order_number) {
        // Sanitize to prevent PostgREST filter injection via .or() interpolation
        const searchNum = sanitizeSearchInput(filters.order_number.replace(/^#/, '').trim());
        if (!searchNum) {
          return { success: false, orders: [], total: 0, error: 'Invalid order_number' };
        }
        query = query.or(
          `shopify_order_name.ilike.%${searchNum}%,shopify_order_number.ilike.%${searchNum}%,order_number.ilike.%${searchNum}%`
        );
      } else if (filters.phone) {
        const normalizedPhone = filters.phone.replace(/[^\d+]/g, '');
        query = query.eq('customer_phone', normalizedPhone);
      }

      if (filters.status) {
        const validStatuses = ['pending', 'contacted', 'confirmed', 'in_preparation', 'ready_to_ship', 'shipped', 'in_transit', 'delivered', 'cancelled', 'returned'];
        if (validStatuses.includes(filters.status)) {
          query = query.eq('sleeves_status', filters.status);
        }
      }

      query = query.order('created_at', { ascending: false }).limit(limit);

      const { data, error, count } = await query;

      if (error) {
        logger.error('BACKEND', '❌ [ExternalWebhook] Error looking up orders:', error);
        return { success: false, orders: [], total: 0, error: 'Error querying orders' };
      }

      // Transform orders for external consumption
      const orders = (data || []).map((order: any) => ({
        id: order.id,
        order_number: order.shopify_order_name || order.shopify_order_number || order.order_number || null,
        status: order.sleeves_status,
        customer_name: [order.customer_first_name, order.customer_last_name].filter(Boolean).join(' '),
        customer_phone: order.customer_phone,
        customer_email: order.customer_email,
        address: order.customer_address,
        city: order.shipping_city || order.delivery_zone,
        total_price: order.total_price,
        subtotal: order.subtotal_price,
        shipping_cost: order.total_shipping,
        discount: order.total_discounts,
        cod_amount: order.cod_amount,
        payment_method: order.payment_method,
        financial_status: order.financial_status,
        is_pickup: order.is_pickup || false,
        delivery_preferences: order.delivery_preferences,
        delivery_notes: order.delivery_notes,
        created_at: order.created_at,
        confirmed_at: order.confirmed_at,
        delivered_at: order.delivered_at,
        items: Array.isArray(order.line_items) ? order.line_items.map((item: any) => ({
          name: item.name || item.title,
          sku: item.sku || null,
          quantity: item.quantity,
          price: item.price,
          variant_title: item.variant_title || null
        })) : []
      }));

      return { success: true, orders, total: count || orders.length };
    } catch (error: any) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error in lookupOrders:', error);
      return { success: false, orders: [], total: 0, error: error.message || 'Unknown error' };
    }
  }

  // ================================================================
  // ORDER CONFIRMATION (Public API)
  // ================================================================

  /**
   * Encuentra una orden por número o ID dentro de una tienda
   */
  private async findOrderByNumber(
    storeId: string,
    orderNumber: string
  ): Promise<{ id: string; status: string } | null> {
    try {
      // Sanitize to prevent PostgREST filter injection via .or() interpolation
      const rawNum = orderNumber.replace(/^#/, '').trim();
      const searchNum = sanitizeSearchInput(rawNum);
      if (!searchNum) return null;

      const sanitizedOriginal = sanitizeSearchInput(orderNumber);

      // Try shopify_order_name first (most common: #1315)
      const { data } = await supabaseAdmin
        .from('orders')
        .select('id, sleeves_status')
        .eq('store_id', storeId)
        .is('deleted_at', null)
        .or(`shopify_order_name.eq.#${searchNum},shopify_order_name.eq.${searchNum},shopify_order_number.eq.${searchNum},order_number.eq.ORD-${searchNum.padStart(5, '0')},order_number.eq.${sanitizedOriginal}`)
        .limit(1)
        .maybeSingle();

      return data ? { id: data.id, status: data.sleeves_status } : null;
    } catch (error) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error finding order:', error);
      return null;
    }
  }

  /**
   * Confirma una orden vía API key (sin JWT)
   * Usa el mismo RPC confirm_order_atomic que el dashboard
   */
  async confirmOrderViaApi(
    storeId: string,
    identifier: { order_number: string },
    options: {
      courier_id?: string;
      is_pickup?: boolean;
      address?: string;
      latitude?: number;
      longitude?: number;
      google_maps_link?: string;
      delivery_zone?: string;
      shipping_cost?: number;
      delivery_preferences?: any;
    },
    config: WebhookConfig
  ): Promise<{
    success: boolean;
    order_id?: string;
    order_number?: string;
    status?: string;
    awaiting_carrier?: boolean;
    confirmed_at?: string;
    carrier_name?: string | null;
    is_pickup?: boolean;
    total_price?: number;
    shipping_cost?: number;
    error?: string;
    code?: string;
  }> {
    try {
      // 1. Find the order
      const order = await this.findOrderByNumber(storeId, identifier.order_number);
      if (!order) {
        return { success: false, error: 'Order not found', code: 'ORDER_NOT_FOUND' };
      }

      // 2. Validate status
      if (order.status !== 'pending' && order.status !== 'contacted') {
        return {
          success: false,
          error: `Order is already ${order.status}. Only pending or contacted orders can be confirmed.`,
          code: 'INVALID_STATUS'
        };
      }

      // 3. Confirm via RPC
      // Two paths: with carrier (full confirm) or without carrier (awaiting assignment)
      const isPickup = options.is_pickup === true;
      const hasCarrier = !!options.courier_id;
      const confirmWithoutCarrier = !hasCarrier && !isPickup;

      let rpcResult: any;
      let rpcError: any;
      let finalStatus: string;

      if (confirmWithoutCarrier) {
        // Path A: Confirm without carrier - order goes to 'confirmed' awaiting carrier assignment
        // The admin/owner assigns the carrier later from the dashboard
        const rpc = await supabaseAdmin.rpc('confirm_order_without_carrier', {
          p_order_id: order.id,
          p_store_id: storeId,
          p_confirmed_by: `api:${config.api_key_prefix}`,
          p_address: options.address || null,
          p_google_maps_link: options.google_maps_link || null,
          p_discount_amount: null,
          p_mark_as_prepaid: false,
          p_prepaid_method: null
        });
        rpcResult = rpc.data;
        rpcError = rpc.error;
        finalStatus = 'confirmed';
      } else {
        // Path B: Full confirmation with carrier or pickup
        const rpc = await supabaseAdmin.rpc('confirm_order_atomic', {
          p_order_id: order.id,
          p_store_id: storeId,
          p_confirmed_by: `api:${config.api_key_prefix}`,
          p_courier_id: isPickup ? null : (options.courier_id || null),
          p_address: options.address || null,
          p_latitude: options.latitude !== undefined ? Number(options.latitude) : null,
          p_longitude: options.longitude !== undefined ? Number(options.longitude) : null,
          p_google_maps_link: options.google_maps_link || null,
          p_delivery_zone: options.delivery_zone || null,
          p_shipping_cost: options.shipping_cost !== undefined ? Number(options.shipping_cost) : null,
          p_upsell_product_id: null,
          p_upsell_quantity: 1,
          p_discount_amount: null,
          p_mark_as_prepaid: false,
          p_prepaid_method: null
        });
        rpcResult = rpc.data;
        rpcError = rpc.error;
        finalStatus = 'confirmed';
      }

      if (rpcError) {
        const errorMessage = rpcError.message || '';

        if (errorMessage.includes('ORDER_NOT_FOUND')) {
          return { success: false, error: 'Order not found', code: 'ORDER_NOT_FOUND' };
        }
        if (errorMessage.includes('INVALID_STATUS')) {
          return { success: false, error: 'Order cannot be confirmed in its current status', code: 'INVALID_STATUS' };
        }
        if (errorMessage.includes('CARRIER_NOT_FOUND')) {
          return { success: false, error: 'Carrier not found or inactive', code: 'CARRIER_NOT_FOUND' };
        }

        return { success: false, error: 'Confirmation failed', code: 'CONFIRMATION_ERROR' };
      }

      if (!rpcResult?.success) {
        return { success: false, error: 'Confirmation did not return valid data', code: 'CONFIRMATION_ERROR' };
      }

      // 4. Save delivery preferences if provided (non-blocking)
      if (options.delivery_preferences && typeof options.delivery_preferences === 'object') {
        try {
          await supabaseAdmin
            .from('orders')
            .update({ delivery_preferences: options.delivery_preferences })
            .eq('id', order.id);
        } catch {
          // Non-critical
        }
      }

      // 5. Log status change to history (audit, non-blocking)
      try {
        await supabaseAdmin
          .from('order_status_history')
          .insert({
            order_id: order.id,
            store_id: storeId,
            previous_status: order.status,
            new_status: 'confirmed',
            changed_by: `api:${config.api_key_prefix}`,
            change_source: 'external_api',
            notes: confirmWithoutCarrier
              ? 'Order confirmed via external API (awaiting carrier assignment)'
              : isPickup
                ? 'Order confirmed as pickup via external API'
                : 'Order confirmed with carrier via external API'
          });
      } catch {
        // Non-critical audit
      }

      // 6. Get the order number for the response
      const { data: orderData } = await supabaseAdmin
        .from('orders')
        .select('shopify_order_name, shopify_order_number, order_number, total_price, total_shipping, confirmed_at')
        .eq('id', order.id)
        .single();

      const orderNumber = orderData?.shopify_order_name || orderData?.shopify_order_number || orderData?.order_number || null;

      return {
        success: true,
        order_id: order.id,
        order_number: orderNumber,
        status: finalStatus,
        awaiting_carrier: confirmWithoutCarrier,
        confirmed_at: orderData?.confirmed_at || new Date().toISOString(),
        carrier_name: confirmWithoutCarrier ? null : (rpcResult.carrier_name || null),
        is_pickup: isPickup,
        total_price: orderData?.total_price,
        shipping_cost: orderData?.total_shipping
      };
    } catch (error: any) {
      logger.error('BACKEND', '❌ [ExternalWebhook] Error confirming order via API:', error);
      return { success: false, error: error.message || 'Unknown error', code: 'SERVER_ERROR' };
    }
  }
}

// Singleton instance
export const externalWebhookService = new ExternalWebhookService();

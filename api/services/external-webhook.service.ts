// ================================================================
// EXTERNAL WEBHOOK SERVICE
// ================================================================
// Procesa pedidos recibidos desde sistemas externos (landing pages, etc.)
// Incluye: autenticación por API Key, creación de clientes, y órdenes
// ================================================================

import crypto from 'crypto';
import { supabaseAdmin } from '../db/connection';

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
    address: string;
    city: string;
    country?: string;
    reference?: string;
    notes?: string;
  };

  items: Array<{
    name: string;
    sku?: string;
    quantity: number;
    price: number;
    variant_title?: string;
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
   * Formato: wh_ + 32 bytes hex = 68 caracteres total
   */
  static generateApiKey(): { key: string; prefix: string } {
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const key = `wh_${randomBytes}`;
    const prefix = key.substring(0, 12) + '...';
    return { key, prefix };
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
        .eq('api_key', apiKey)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        console.log(`❌ [ExternalWebhook] Invalid API key for store ${storeId}`);
        return null;
      }

      return data as WebhookConfig;
    } catch (error) {
      console.error('❌ [ExternalWebhook] Error validating API key:', error);
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
      timestamp: Math.floor(Date.now() / 60000) // Agrupar por minuto
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
      console.error('❌ [ExternalWebhook] Error recording idempotency:', error);
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
    if (!payload.shipping_address) {
      errors.push({ field: 'shipping_address', message: 'Shipping address is required' });
    } else {
      if (!payload.shipping_address.address || payload.shipping_address.address.trim() === '') {
        errors.push({ field: 'shipping_address.address', message: 'Address is required' });
      }
      if (!payload.shipping_address.city || payload.shipping_address.city.trim() === '') {
        errors.push({ field: 'shipping_address.city', message: 'City is required' });
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
          console.log(`✅ [ExternalWebhook] Found existing customer by email: ${customerData.email}`);
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
          console.log(`✅ [ExternalWebhook] Found existing customer by phone: ${normalizedPhone}`);
          return { customerId: byPhone.id, isNew: false };
        }
      }

      // 3. Crear nuevo cliente
      const newCustomer = {
        store_id: storeId,
        name: customerData.name,
        email: customerData.email || null,
        phone: customerData.phone ? this.normalizePhone(customerData.phone) : null,
        address: shippingAddress.address,
        city: shippingAddress.city,
        country: shippingAddress.country || 'Paraguay',
        notes: shippingAddress.reference || null,
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
        console.error('❌ [ExternalWebhook] Error creating customer:', error);
        throw new Error(`Failed to create customer: ${error.message}`);
      }

      console.log(`✅ [ExternalWebhook] Created new customer: ${created.id}`);
      return { customerId: created.id, isNew: true };
    } catch (error) {
      console.error('❌ [ExternalWebhook] Error in findOrCreateCustomer:', error);
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
        console.log(`⚠️ [ExternalWebhook] Duplicate order detected: ${idempotencyKey}`);

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
        console.log(`❌ [ExternalWebhook] Validation failed:`, validation.errors);

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
      const shippingAddressJson = {
        address1: payload.shipping_address.address,
        city: payload.shipping_address.city,
        country: payload.shipping_address.country || 'Paraguay',
        reference: payload.shipping_address.reference || null,
        notes: payload.shipping_address.notes || null
      };

      const orderData = {
        store_id: storeId,
        customer_id: customerId,
        order_number: orderNumber,
        external_order_id: payload.idempotency_key || idempotencyKey,
        source: 'webhook_externo',

        // Customer info (denormalized)
        customer_name: payload.customer.name,
        customer_email: payload.customer.email || null,
        customer_phone: payload.customer.phone || null,

        // Shipping
        shipping_address: shippingAddressJson,
        delivery_notes: payload.shipping_address.notes || null,

        // Products
        line_items: lineItems,

        // Totals
        subtotal: payload.totals.subtotal || payload.totals.total,
        shipping_cost: payload.totals.shipping || 0,
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
        console.error('❌ [ExternalWebhook] Error creating order:', orderError);

        // Actualizar log
        if (logId) {
          await this.updateLogStatus(logId, 'failed', null, orderError.message, Date.now() - startTime);
        }

        return {
          success: false,
          error: `Failed to create order: ${orderError.message}`
        };
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

      console.log(`✅ [ExternalWebhook] Order created successfully: ${order.order_number} (${order.id})`);

      return {
        success: true,
        orderId: order.id,
        orderNumber: order.order_number,
        customerId: customerId
      };

    } catch (error: any) {
      console.error('❌ [ExternalWebhook] Error processing order:', error);

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
      console.error('❌ [ExternalWebhook] Error updating log status:', error);
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
      console.error('❌ [ExternalWebhook] Error getting config:', error);
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
        api_key: apiKey,
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
        console.error('❌ [ExternalWebhook] Error creating config:', error);
        return { error: `Failed to create webhook configuration: ${error.message}` };
      }

      console.log(`✅ [ExternalWebhook] Created webhook config for store ${storeId}`);
      return { config: data as WebhookConfig, apiKey };
    } catch (error: any) {
      console.error('❌ [ExternalWebhook] Error creating config:', error);
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
          api_key: apiKey,
          api_key_prefix: apiKeyPrefix,
          updated_at: new Date().toISOString()
        })
        .eq('store_id', storeId);

      if (error) {
        return { error: `Failed to regenerate API key: ${error.message}` };
      }

      console.log(`✅ [ExternalWebhook] Regenerated API key for store ${storeId}`);
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

      console.log(`✅ [ExternalWebhook] Disabled webhook for store ${storeId}`);
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

      console.log(`✅ [ExternalWebhook] Deleted webhook config for store ${storeId}`);
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
        console.error('❌ [ExternalWebhook] Error getting logs:', error);
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
      console.error('❌ [ExternalWebhook] Error getting logs:', error);
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
      console.error('❌ [ExternalWebhook] Error getting log:', error);
      return null;
    }
  }
}

// Singleton instance
export const externalWebhookService = new ExternalWebhookService();

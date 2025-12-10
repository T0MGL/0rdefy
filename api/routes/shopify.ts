// Shopify Integration Routes
// Rutas para configurar integracion, sincronizacion manual y webhooks

import { Router, Request, Response } from 'express';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../db/connection';
import { ShopifyClientService } from '../services/shopify-client.service';
import { ShopifyImportService } from '../services/shopify-import.service';
import { ShopifyProductSyncService } from '../services/shopify-product-sync.service';
import { ShopifyWebhookService } from '../services/shopify-webhook.service';
import { ShopifyWebhookManager } from '../services/shopify-webhook-manager.service';
import { ShopifyWebhookSetupService } from '../services/shopify-webhook-setup.service';
import { WebhookQueueService } from '../services/webhook-queue.service';
import { ShopifyIntegration, ShopifyConfigRequest } from '../types/shopify';

export const shopifyRouter = Router();

// ================================================================
// WEBHOOK QUEUE SERVICE - CRITICAL FOR PRODUCTION
// ================================================================
// Initialize webhook queue service for async processing
// This ensures we respond to Shopify < 5 seconds even during high traffic
const webhookQueue = new WebhookQueueService(supabaseAdmin);

// TEMPORARILY DISABLED: Auto-processing disabled until migration 024 is applied
// To enable: Apply db/migrations/024_webhook_queue_system.sql to production DB
// Then uncomment the lines below
/*
// Start processing webhooks in background
webhookQueue.startProcessing();
console.log('✅ [SHOPIFY] Webhook queue processor started');

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('🛑 [SHOPIFY] Shutting down webhook queue processor...');
  webhookQueue.stopProcessing();
});
*/
console.log('⚠️ [SHOPIFY] Webhook queue processor disabled - waiting for migration 024');

// Aplicar autenticacion a todas las rutas excepto webhooks CALLBACK
// CRITICAL: Skip auth only for webhook callback endpoints, not management endpoints
// Management endpoints like /webhooks/list, /webhooks/setup, etc. require auth
const isWebhookCallback = (path: string): boolean => {
  const webhookCallbackPaths = [
    '/webhook/orders-create',
    '/webhooks/orders-create',
    '/webhook/orders-updated',
    '/webhooks/orders-updated',
    '/webhook/products-update',
    '/webhooks/products-update',
    '/webhook/products-delete',
    '/webhooks/products-delete',
    '/webhook/customers/data_request',
    '/webhooks/customers/data_request',
    '/webhook/customers/redact',
    '/webhooks/customers/redact',
    '/webhook/app-uninstalled',
    '/webhooks/app-uninstalled',
    '/webhook/shop/redact',
    '/webhooks/shop/redact'
  ];
  return webhookCallbackPaths.includes(path);
};

shopifyRouter.use((req: Request, res: Response, next) => {
  if (isWebhookCallback(req.path)) {
    return next();
  }
  return verifyToken(req as AuthRequest, res, next);
});

shopifyRouter.use((req: Request, res: Response, next) => {
  if (isWebhookCallback(req.path)) {
    return next();
  }
  return extractStoreId(req as AuthRequest, res, next);
});

// POST /api/shopify/configure
// Configurar integracion de Shopify y iniciar importacion inicial
shopifyRouter.post('/configure', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const config: ShopifyConfigRequest = req.body;

    // Validar datos requeridos
    if (!config.shop_domain || !config.access_token) {
      return res.status(400).json({
        success: false,
        error: 'Dominio de tienda y token de acceso son requeridos'
      });
    }

    // Crear cliente de Shopify temporal para verificar conexion
    const tempIntegration: ShopifyIntegration = {
      id: '',
      store_id: storeId!,
      shop_domain: config.shop_domain,
      api_key: config.api_key,
      api_secret_key: config.api_secret_key,
      access_token: config.access_token,
      webhook_signature: config.webhook_signature,
      import_products: config.import_products,
      import_customers: config.import_customers,
      import_orders: config.import_orders,
      import_historical_orders: config.import_historical_orders,
      status: 'active',
      last_sync_at: null,
      sync_error: null,
      shopify_shop_id: null,
      shop_name: null,
      shop_email: null,
      shop_currency: null,
      shop_timezone: null,
      shop_data: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const shopifyClient = new ShopifyClientService(tempIntegration);

    // Probar conexion
    const connectionTest = await shopifyClient.testConnection();
    if (!connectionTest.success) {
      return res.status(400).json({
        success: false,
        error: connectionTest.error || 'Error conectando con Shopify'
      });
    }

    // Guardar o actualizar configuracion en la base de datos
    const { data: existingIntegration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id')
      .eq('store_id', storeId)
      .single();

    let integrationId: string;

    if (existingIntegration) {
      // Actualizar existente
      const { data, error } = await supabaseAdmin
        .from('shopify_integrations')
        .update({
          shop_domain: config.shop_domain,
          api_key: config.api_key,
          api_secret_key: config.api_secret_key,
          access_token: config.access_token,
          webhook_signature: config.webhook_signature,
          import_products: config.import_products,
          import_customers: config.import_customers,
          import_orders: config.import_orders,
          import_historical_orders: config.import_historical_orders,
          status: 'active',
          shopify_shop_id: connectionTest.shop_data.id?.toString(),
          shop_name: connectionTest.shop_data.name,
          shop_email: connectionTest.shop_data.email,
          shop_currency: connectionTest.shop_data.currency,
          shop_timezone: connectionTest.shop_data.timezone,
          shop_data: connectionTest.shop_data
        })
        .eq('id', existingIntegration.id)
        .select('id')
        .single();

      if (error) throw error;
      integrationId = data.id;
    } else {
      // Crear nuevo
      const { data, error } = await supabaseAdmin
        .from('shopify_integrations')
        .insert({
          store_id: storeId,
          shop_domain: config.shop_domain,
          api_key: config.api_key,
          api_secret_key: config.api_secret_key,
          access_token: config.access_token,
          webhook_signature: config.webhook_signature,
          import_products: config.import_products,
          import_customers: config.import_customers,
          import_orders: config.import_orders,
          import_historical_orders: config.import_historical_orders,
          status: 'active',
          shopify_shop_id: connectionTest.shop_data.id?.toString(),
          shop_name: connectionTest.shop_data.name,
          shop_email: connectionTest.shop_data.email,
          shop_currency: connectionTest.shop_data.currency,
          shop_timezone: connectionTest.shop_data.timezone,
          shop_data: connectionTest.shop_data
        })
        .select('id')
        .single();

      if (error) throw error;
      integrationId = data.id;
    }

    // Obtener integracion completa
    const { data: integration, error: fetchError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('id', integrationId)
      .single();

    if (fetchError) throw fetchError;

    // ================================================================
    // REGISTRO AUTOMÁTICO DE WEBHOOKS
    // ================================================================
    console.log('🔌 Registrando webhooks en Shopify...');
    const webhookSetup = new ShopifyWebhookSetupService(integration);
    const webhookResult = await webhookSetup.setupWebhooks();

    if (!webhookResult.success) {
      console.warn('⚠️  Algunos webhooks no se pudieron registrar:', webhookResult.errors);
      // No fallar la configuración por errores de webhooks
      // Los webhooks se pueden configurar manualmente después
    } else {
      console.log('✅ Webhooks registrados exitosamente:', webhookResult.registered);
    }

    // Iniciar importacion en background
    // IMPORTANTE: Solo productos y clientes, NUNCA ordenes historicas
    const importService = new ShopifyImportService(supabaseAdmin, integration);
    const importTypes: Array<'products' | 'customers'> = [];

    if (config.import_products) importTypes.push('products');
    if (config.import_customers) importTypes.push('customers');
    // NO importar ordenes historicas - las nuevas se cargan via webhook

    const jobIds = await importService.startImport({
      job_type: 'initial',
      import_types: importTypes,
      force_full_sync: true
    });

    res.json({
      success: true,
      integration_id: integrationId,
      job_ids: jobIds,
      webhooks: {
        registered: webhookResult.registered,
        skipped: webhookResult.skipped,
        errors: webhookResult.errors
      },
      message: `Integracion configurada exitosamente. ${webhookResult.registered.length} webhooks registrados. Importacion iniciada en segundo plano.`
    });

  } catch (error: any) {
    console.error('Error configurando Shopify:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error configurando integracion'
    });
  }
});

// POST /api/shopify/manual-sync
// Iniciar sincronizacion manual (SOLO productos y clientes, NUNCA ordenes historicas)
shopifyRouter.post('/manual-sync', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const { sync_type } = req.body;

    // IMPORTANTE: No permitir sincronizacion de ordenes historicas
    // Las ordenes nuevas se cargan automaticamente via webhooks
    if (!sync_type || !['products', 'customers', 'all'].includes(sync_type)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo de sincronizacion invalido. Solo se permiten: products, customers, all'
      });
    }

    // Obtener integracion
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integracion de Shopify no encontrada'
      });
    }

    // Iniciar sincronizacion (NUNCA incluir ordenes)
    const importService = new ShopifyImportService(supabaseAdmin, integration);
    const importTypes: Array<'products' | 'customers'> = [];

    if (sync_type === 'all') {
      // Solo productos y clientes, NUNCA ordenes
      if (integration.import_products) importTypes.push('products');
      if (integration.import_customers) importTypes.push('customers');
    } else {
      importTypes.push(sync_type as 'products' | 'customers');
    }

    const jobIds = await importService.startImport({
      job_type: 'manual',
      import_types: importTypes,
      force_full_sync: false
    });

    res.json({
      success: true,
      job_ids: jobIds,
      message: 'Sincronizacion manual iniciada (productos y clientes)',
      note: 'Las nuevas ordenes se cargan automaticamente via webhooks'
    });

  } catch (error: any) {
    console.error('Error en sincronizacion manual:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error iniciando sincronizacion'
    });
  }
});

// POST /api/shopify/sync-orders
// Sincronizar pedidos desde Shopify manualmente
shopifyRouter.post('/sync-orders', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    // Obtener integracion activa
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integración de Shopify no encontrada'
      });
    }

    // Iniciar importación de pedidos
    const importService = new ShopifyImportService(supabaseAdmin, integration);
    const jobIds = await importService.startImport({
      job_type: 'manual',
      import_types: ['orders'],
      force_full_sync: false
    });

    res.json({
      success: true,
      job_ids: jobIds,
      message: 'Sincronización de pedidos iniciada',
      integration_id: integration.id
    });

  } catch (error: any) {
    console.error('Error sincronizando pedidos:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error iniciando sincronización de pedidos'
    });
  }
});

// GET /api/shopify/import-status/:integration_id
// Obtener estado de importacion en tiempo real
shopifyRouter.get('/import-status/:integration_id', async (req: AuthRequest, res: Response) => {
  try {
    const { integration_id } = req.params;
    const storeId = req.storeId;

    // Verificar que la integracion pertenece al store
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('id', integration_id)
      .eq('store_id', storeId)
      .single();

    if (error || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integracion no encontrada'
      });
    }

    // Obtener estado de importacion
    const importService = new ShopifyImportService(supabaseAdmin, integration);
    const status = await importService.getImportStatus(integration_id);

    res.json({
      success: true,
      ...status
    });

  } catch (error: any) {
    console.error('Error obteniendo estado de importacion:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error obteniendo estado'
    });
  }
});

// POST /api/shopify/webhook/orders-create OR /webhooks/orders-create
// Webhook para nuevos pedidos de Shopify (con retry automático y deduplicación)
// IMPORTANT: Support both /webhook/ (singular) and /webhooks/ (plural) for Shopify compatibility
const ordersCreateHandler = async (req: Request, res: Response) => {
  const startTime = Date.now();
  let integrationId: string | null = null;
  let storeId: string | null = null;

  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    // CRITICAL: Must use rawBody from middleware for correct HMAC verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      console.error('❌ CRITICAL: rawBody not available - middleware not working correctly');
      console.error('   Path:', req.path);
      console.error('   This will cause HMAC verification to fail');
      return res.status(500).json({ error: 'Server configuration error - rawBody middleware not working' });
    }

    if (!shopDomain || !hmacHeader) {
      console.error('❌ Webhook missing required headers');
      return res.status(401).json({ error: 'Unauthorized - missing headers' });
    }

    // Obtener integracion por dominio
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('shop_domain', shopDomain)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      console.error('❌ Integration not found for domain:', shopDomain);
      return res.status(404).json({ error: 'Integration not found' });
    }

    integrationId = integration.id;
    storeId = integration.store_id;

    // Initialize webhook manager
    const webhookManager = new ShopifyWebhookManager(supabaseAdmin);

    // Record metric: received
    await webhookManager.recordMetric(integrationId!, storeId!, 'received');

    // Verificar HMAC - SIEMPRE usar .env como fuente de verdad
    const webhookSecret = process.env.SHOPIFY_API_SECRET?.trim();

    if (!webhookSecret) {
      console.error('❌ SHOPIFY_API_SECRET not configured in .env (or is empty)');
      await webhookManager.recordMetric(integrationId!, storeId!, 'failed', Date.now() - startTime, '500');
      return res.status(500).json({ error: 'Webhook secret not configured in environment' });
    }

    console.log('🔐 Using SHOPIFY_API_SECRET from .env for HMAC verification');

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      webhookSecret
    );

    if (!isValid) {
      console.error('❌ Invalid HMAC signature');
      await webhookManager.recordMetric(
        integrationId!,
        storeId!,
        'failed',
        Date.now() - startTime,
        '401'
      );
      return res.status(401).json({ error: 'Unauthorized - invalid HMAC' });
    }

    // Check for replay attacks - reject webhooks older than 5 minutes
    const webhookTimestamp = req.body.created_at || req.body.updated_at;
    if (webhookTimestamp) {
      const webhookDate = new Date(webhookTimestamp);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (webhookDate < fiveMinutesAgo) {
        console.warn('⚠️ Webhook rejected: older than 5 minutes');
        await webhookManager.recordMetric(integrationId!, storeId!, 'duplicate');
        return res.status(200).json({ success: true, message: 'Webhook too old' });
      }
    }

    // Generate idempotency key
    const orderId = req.body.id?.toString();
    if (!orderId) {
      console.error('❌ Webhook missing order ID');
      return res.status(400).json({ error: 'Missing order ID' });
    }

    const idempotencyKey = webhookManager.generateIdempotencyKey(
      orderId,
      'orders/create',
      webhookTimestamp
    );

    // Check for duplicate
    const idempotencyCheck = await webhookManager.checkIdempotency(
      integrationId!,
      idempotencyKey
    );

    if (idempotencyCheck.is_duplicate) {
      console.warn(`⚠️ Duplicate webhook: ${idempotencyKey}`);
      await webhookManager.recordMetric(integrationId!, storeId!, 'duplicate');
      return res.status(200).json({
        success: true,
        message: 'Already processed',
        idempotency_key: idempotencyKey,
      });
    }

    // ================================================================
    // CRITICAL: RESPOND IMMEDIATELY (< 1 SECOND)
    // ================================================================
    // Shopify requires response in < 5 seconds
    // Try to enqueue for async processing; fallback to sync if queue unavailable
    try {
      const queueId = await webhookQueue.enqueue({
        integration_id: integrationId!,
        store_id: storeId!,
        topic: 'orders/create',
        payload: req.body,
        headers: {
          'X-Shopify-Shop-Domain': shopDomain!,
          'X-Shopify-Hmac-Sha256': hmacHeader!,
        },
        idempotency_key: idempotencyKey,
      });

      // Record idempotency immediately (processing will happen async)
      await webhookManager.recordIdempotency(
        integrationId!,
        idempotencyKey,
        orderId,
        'orders/create',
        true,
        200,
        'queued'
      );

      const responseTime = Date.now() - startTime;
      console.log(
        `✅ Webhook queued in ${responseTime}ms: ${orderId} (queue_id: ${queueId})`
      );

      // Respond immediately to Shopify
      return res.status(200).json({
        success: true,
        message: 'Webhook queued for processing',
        queue_id: queueId,
        response_time_ms: responseTime,
      });
    } catch (queueError: any) {
      // Fallback to synchronous processing if queue is unavailable
      console.warn('⚠️ Webhook queue unavailable, processing synchronously:', queueError.message);

      const webhookService = new ShopifyWebhookService(supabaseAdmin);
      const result = await webhookService.processOrderCreatedWebhook(
        req.body,
        storeId!,
        integrationId!
      );

      // Record idempotency
      await webhookManager.recordIdempotency(
        integrationId!,
        idempotencyKey,
        orderId,
        'orders/create',
        result.success,
        result.success ? 200 : 500,
        result.success ? 'processed' : result.error || 'failed'
      );

      const responseTime = Date.now() - startTime;
      console.log(`✅ Webhook processed synchronously in ${responseTime}ms: ${orderId}`);

      // Respond to Shopify
      return res.status(200).json({
        success: result.success,
        message: result.success ? 'Webhook processed' : 'Webhook processed with errors',
        response_time_ms: responseTime,
        processing_mode: 'synchronous'
      });
    }
  } catch (error: any) {
    console.error('❌ Error procesando webhook de pedido:', error);

    if (integrationId && storeId) {
      const webhookManager = new ShopifyWebhookManager(supabaseAdmin);
      await webhookManager.recordMetric(
        integrationId,
        storeId,
        'failed',
        Date.now() - startTime,
        '500'
      );
    }

    // Return 200 to prevent Shopify infinite retries
    res.status(200).json({
      success: false,
      error: 'Internal error - will retry',
    });
  }
};

// Register handler for both /webhook/ (singular) and /webhooks/ (plural)
shopifyRouter.post('/webhook/orders-create', ordersCreateHandler);
shopifyRouter.post('/webhooks/orders-create', ordersCreateHandler);

// POST /api/shopify/webhook/orders-updated OR /webhooks/orders-updated
// Webhook para actualizacion de pedidos
const ordersUpdatedHandler = async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    // CRITICAL: Must use rawBody from middleware for correct HMAC verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      console.error('❌ CRITICAL: rawBody not available for orders-updated webhook');
      return res.status(500).json({ error: 'Server configuration error - rawBody middleware not working' });
    }

    if (!shopDomain || !hmacHeader) {
      return res.status(400).json({ error: 'Missing headers' });
    }

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('shop_domain', shopDomain)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    // SIEMPRE usar .env para HMAC
    const webhookSecret = process.env.SHOPIFY_API_SECRET;

    if (!webhookSecret) {
      console.error('❌ SHOPIFY_API_SECRET not configured in .env');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    console.log('🔐 Using SHOPIFY_API_SECRET from .env for orders/updated');

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      webhookSecret
    );

    if (!isValid) {
      console.error('❌ HMAC verification failed for orders/updated');
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    const webhookService = new ShopifyWebhookService(supabaseAdmin);
    const result = await webhookService.processOrderUpdatedWebhook(
      req.body,
      integration.store_id,
      integration.id
    );

    res.json(result);

  } catch (error: any) {
    console.error('Error procesando webhook de actualizacion:', error);
    res.status(500).json({ error: error.message });
  }
};

shopifyRouter.post('/webhook/orders-updated', ordersUpdatedHandler);
shopifyRouter.post('/webhooks/orders-updated', ordersUpdatedHandler);

// POST /api/shopify/webhook/products-update OR /webhooks/products-update
// Webhook para productos actualizados en Shopify
const productsUpdateHandler = async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    // CRITICAL: Must use rawBody from middleware for correct HMAC verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      console.error('❌ CRITICAL: rawBody not available for products-update webhook');
      return res.status(500).json({ error: 'Server configuration error - rawBody middleware not working' });
    }

    if (!shopDomain || !hmacHeader) {
      return res.status(400).json({ error: 'Missing headers' });
    }

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('shop_domain', shopDomain)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    // SIEMPRE usar .env para HMAC
    const webhookSecret = process.env.SHOPIFY_API_SECRET;

    if (!webhookSecret) {
      console.error('❌ SHOPIFY_API_SECRET not configured in .env');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    console.log('🔐 Using SHOPIFY_API_SECRET from .env for products/update');

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      webhookSecret
    );

    if (!isValid) {
      console.error('❌ HMAC verification failed for products/update');
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    const webhookService = new ShopifyWebhookService(supabaseAdmin);
    const result = await webhookService.processProductUpdatedWebhook(
      req.body,
      integration.store_id,
      integration.id
    );

    res.json(result);

  } catch (error: any) {
    console.error('Error procesando webhook de actualización de producto:', error);
    res.status(500).json({ error: error.message });
  }
};

shopifyRouter.post('/webhook/products-update', productsUpdateHandler);
shopifyRouter.post('/webhooks/products-update', productsUpdateHandler);

// POST /api/shopify/webhook/products-delete OR /webhooks/products-delete
// Webhook para productos eliminados en Shopify
const productsDeleteHandler = async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    // CRITICAL: Must use rawBody from middleware for correct HMAC verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      console.error('❌ CRITICAL: rawBody not available for products-delete webhook');
      return res.status(500).json({ error: 'Server configuration error - rawBody middleware not working' });
    }

    if (!shopDomain || !hmacHeader) {
      return res.status(400).json({ error: 'Missing headers' });
    }

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('shop_domain', shopDomain)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    // SIEMPRE usar .env para HMAC
    const webhookSecret = process.env.SHOPIFY_API_SECRET;

    if (!webhookSecret) {
      console.error('❌ SHOPIFY_API_SECRET not configured in .env');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    console.log('🔐 Using SHOPIFY_API_SECRET from .env for products/delete');

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      webhookSecret
    );

    if (!isValid) {
      console.error('❌ HMAC verification failed for products/delete');
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    const webhookService = new ShopifyWebhookService(supabaseAdmin);
    const result = await webhookService.processProductDeletedWebhook(
      req.body.id,
      integration.store_id,
      integration.id
    );

    res.json(result);

  } catch (error: any) {
    console.error('Error procesando webhook de eliminacion:', error);
    res.status(500).json({ error: error.message });
  }
};

shopifyRouter.post('/webhook/products-delete', productsDeleteHandler);
shopifyRouter.post('/webhooks/products-delete', productsDeleteHandler);

// PATCH /api/shopify/products/:id
// Actualizar producto y sincronizar con Shopify
shopifyRouter.patch('/products/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;
    const updates = req.body;

    // Actualizar producto en la base de datos local
    const { data: product, error: updateError } = await supabaseAdmin
      .from('products')
      .update(updates)
      .eq('id', id)
      .eq('store_id', storeId)
      .select('*')
      .single();

    if (updateError || !product) {
      return res.status(404).json({
        success: false,
        error: 'Producto no encontrado'
      });
    }

    // Si el producto tiene shopify_product_id, sincronizar con Shopify
    if (product.shopify_product_id) {
      const { data: integration } = await supabaseAdmin
        .from('shopify_integrations')
        .select('*')
        .eq('store_id', storeId)
        .eq('status', 'active')
        .single();

      if (integration) {
        const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
        const syncResult = await syncService.updateProductInShopify(id);

        if (!syncResult.success) {
          return res.status(200).json({
            success: true,
            product,
            sync_warning: syncResult.error,
            message: 'Producto actualizado localmente pero no se pudo sincronizar con Shopify'
          });
        }
      }
    }

    res.json({
      success: true,
      product,
      message: 'Producto actualizado exitosamente'
    });

  } catch (error: any) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error actualizando producto'
    });
  }
});

// DELETE /api/shopify/products/:id
// Eliminar producto local y de Shopify
shopifyRouter.delete('/products/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;

    // Obtener integracion si existe
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (integration) {
      // Eliminar de Shopify y localmente
      const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
      const result = await syncService.deleteProductFromShopify(id);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } else {
      // Solo eliminar localmente
      const { error } = await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', id)
        .eq('store_id', storeId);

      if (error) throw error;
    }

    res.json({
      success: true,
      message: 'Producto eliminado exitosamente'
    });

  } catch (error: any) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error eliminando producto'
    });
  }
});

// GET /api/shopify/products
// Obtener productos de Shopify para selector de productos
shopifyRouter.get('/products', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const { limit = '50', search } = req.query;

    // Obtener integracion activa
    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (integrationError || !integration) {
      return res.status(404).json({
        success: false,
        error: 'No active Shopify integration found'
      });
    }

    // Crear cliente de Shopify
    const shopifyClient = new ShopifyClientService(integration);

    // Obtener productos de Shopify
    const { products, pagination } = await shopifyClient.getProducts({
      limit: parseInt(limit as string)
    });

    // Filtrar por búsqueda si se proporciona
    let filteredProducts = products;
    if (search) {
      const searchLower = (search as string).toLowerCase();
      filteredProducts = products.filter(p =>
        p.title.toLowerCase().includes(searchLower) ||
        p.variants?.some(v => v.sku?.toLowerCase().includes(searchLower))
      );
    }

    // Transformar productos para el frontend
    const transformedProducts = filteredProducts.map(product => ({
      id: product.id.toString(),
      title: product.title,
      image: product.image?.src || product.images?.[0]?.src || '',
      variants: product.variants?.map(variant => ({
        id: variant.id.toString(),
        title: variant.title,
        sku: variant.sku || '',
        price: parseFloat(variant.price || '0'),
        inventory_quantity: variant.inventory_quantity || 0,
        image_id: variant.image_id
      })) || []
    }));

    res.json({
      success: true,
      products: transformedProducts,
      pagination
    });

  } catch (error: any) {
    console.error('Error fetching Shopify products:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch Shopify products'
    });
  }
});

// GET /api/shopify/integration
// Obtener configuracion actual de Shopify (solo integraciones activas)
shopifyRouter.get('/integration', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, shop_domain, shop_name, status, import_products, import_customers, import_orders, import_historical_orders, last_sync_at, shop_data')
      .eq('store_id', storeId)
      .eq('status', 'active') // Only return active integrations
      .single();

    if (error || !integration) {
      return res.json({
        success: true,
        integration: null,
        message: 'No hay integracion configurada'
      });
    }

    res.json({
      success: true,
      integration
    });

  } catch (error: any) {
    console.error('Error obteniendo integracion:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/shopify/webhook-health
// Obtener salud de webhooks para monitoreo
shopifyRouter.get('/webhook-health', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const hours = parseInt(req.query.hours as string) || 24;

    // Get integration
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integracion no encontrada'
      });
    }

    // Get webhook health metrics
    const webhookManager = new ShopifyWebhookManager(supabaseAdmin);
    const health = await webhookManager.getWebhookHealth(integration.id, hours);

    // Determine health status
    let status = 'healthy';
    const issues: string[] = [];

    if (health.success_rate < 95 && health.total_received > 10) {
      status = 'degraded';
      issues.push(`Success rate is low: ${health.success_rate.toFixed(1)}%`);
    }

    if (health.pending_retries > 50) {
      status = 'degraded';
      issues.push(`High number of pending retries: ${health.pending_retries}`);
    }

    if (health.success_rate < 80 && health.total_received > 10) {
      status = 'unhealthy';
      issues.push(`Critical: Success rate is very low: ${health.success_rate.toFixed(1)}%`);
    }

    if (health.error_breakdown['401_unauthorized'] > 5) {
      status = 'unhealthy';
      issues.push('Authentication errors detected - check Shopify credentials');
    }

    res.json({
      success: true,
      status,
      issues,
      metrics: health,
      period_hours: hours,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Error obteniendo salud de webhooks:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/shopify/webhook-retry/process
// Procesar cola de reintentos manualmente (también se ejecuta como cron job)
shopifyRouter.post('/webhook-retry/process', async (req: AuthRequest, res: Response) => {
  try {
    const webhookManager = new ShopifyWebhookManager(supabaseAdmin);
    const result = await webhookManager.processRetryQueue();

    res.json({
      success: true,
      ...result,
      message: `Processed ${result.processed} retries: ${result.succeeded} succeeded, ${result.failed} failed, ${result.still_pending} pending`
    });

  } catch (error: any) {
    console.error('Error procesando cola de reintentos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/shopify/webhook-cleanup
// Limpiar idempotency keys expirados (ejecutar como cron job diario)
shopifyRouter.post('/webhook-cleanup', async (req: AuthRequest, res: Response) => {
  try {
    const webhookManager = new ShopifyWebhookManager(supabaseAdmin);
    const deleted = await webhookManager.cleanupExpiredKeys();

    // También limpiar webhook queue antiguos (si está disponible)
    let queueDeleted = 0;
    try {
      queueDeleted = await webhookQueue.cleanupOldWebhooks();
    } catch (queueError: any) {
      console.warn('⚠️ Webhook queue cleanup skipped (table not available):', queueError.message);
    }

    res.json({
      success: true,
      deleted_keys: deleted,
      deleted_queue_items: queueDeleted,
      message: `Cleaned up ${deleted} expired idempotency keys and ${queueDeleted} old webhook queue items`
    });

  } catch (error: any) {
    console.error('Error limpiando idempotency keys:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================================================================
// RECONCILIATION ENDPOINTS (CRITICAL FOR PRODUCTION)
// ================================================================

// POST /api/shopify/reconciliation/run
// Ejecutar reconciliación manual (también se ejecuta como cron job)
shopifyRouter.post('/reconciliation/run', async (req: AuthRequest, res: Response) => {
  try {
    const { ReconciliationService } = await import('../services/reconciliation.service');
    const reconciliationService = new ReconciliationService(supabaseAdmin);

    console.log('🔄 [API] Starting manual reconciliation...');
    const results = await reconciliationService.runFullReconciliation();

    res.json({
      success: results.success,
      ...results,
      message: `Reconciliation completed: ${results.integrations_processed} integrations, ${results.orders_synced} orders synced`
    });

  } catch (error: any) {
    console.error('❌ [API] Error running reconciliation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/shopify/queue/stats
// Obtener estadísticas de la cola de webhooks
shopifyRouter.get('/queue/stats', async (req: AuthRequest, res: Response) => {
  try {
    let stats;
    try {
      stats = await webhookQueue.getQueueStats();
    } catch (queueError: any) {
      console.warn('⚠️ Webhook queue stats unavailable (table not available):', queueError.message);
      stats = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0, error: 'Queue not initialized - migration 024 pending' };
    }

    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ [API] Error getting queue stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================================================================
// WEBHOOK MANAGEMENT ENDPOINTS
// ================================================================

// POST /api/shopify/webhooks/setup
// Registrar webhooks manualmente (útil si falla durante /configure)
shopifyRouter.post('/webhooks/setup', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    // Obtener integración activa
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integración de Shopify no encontrada'
      });
    }

    // Registrar webhooks
    const webhookSetup = new ShopifyWebhookSetupService(integration);
    const result = await webhookSetup.setupWebhooks();

    res.json({
      success: result.success,
      registered: result.registered,
      skipped: result.skipped,
      errors: result.errors,
      message: `${result.registered.length} webhooks registrados, ${result.skipped.length} ya existían, ${result.errors.length} errores`
    });

  } catch (error: any) {
    console.error('Error configurando webhooks:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/shopify/webhooks/verify
// Verificar que los webhooks estén correctamente configurados
shopifyRouter.get('/webhooks/verify', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integración de Shopify no encontrada'
      });
    }

    const webhookSetup = new ShopifyWebhookSetupService(integration);
    const verification = await webhookSetup.verifyWebhooks();

    res.json({
      success: true,
      valid: verification.valid,
      missing: verification.missing,
      misconfigured: verification.misconfigured,
      message: verification.valid
        ? 'Todos los webhooks están correctamente configurados'
        : `${verification.missing.length} webhooks faltantes, ${verification.misconfigured.length} mal configurados`
    });

  } catch (error: any) {
    console.error('Error verificando webhooks:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/shopify/webhooks/list
// Listar todos los webhooks registrados en Shopify
shopifyRouter.get('/webhooks/list', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integración de Shopify no encontrada'
      });
    }

    const shopifyClient = new ShopifyClientService(integration);
    const webhooks = await shopifyClient.listWebhooks();

    res.json({
      success: true,
      webhooks: webhooks.map((w: any) => ({
        id: w.id,
        topic: w.topic,
        address: w.address,
        format: w.format,
        created_at: w.created_at
      })),
      count: webhooks.length
    });

  } catch (error: any) {
    console.error('Error listando webhooks:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /api/shopify/webhooks/remove-all
// Eliminar todos los webhooks (útil para cleanup o reset)
shopifyRouter.delete('/webhooks/remove-all', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      return res.status(404).json({
        success: false,
        error: 'Integración de Shopify no encontrada'
      });
    }

    const webhookSetup = new ShopifyWebhookSetupService(integration);
    const result = await webhookSetup.removeAllWebhooks();

    res.json({
      success: result.success,
      removed: result.removed,
      errors: result.errors,
      message: `${result.removed} webhooks eliminados`
    });

  } catch (error: any) {
    console.error('Error eliminando webhooks:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ================================================================
// GDPR MANDATORY WEBHOOKS FOR PUBLIC SHOPIFY APPS
// ================================================================

// POST /api/shopify/webhook/customers/data_request OR /webhooks/customers/data_request
// Shopify calls this when a customer requests their data (GDPR compliance)
const customersDataRequestHandler = async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    // CRITICAL: Must use rawBody from middleware for correct HMAC verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      console.error('❌ CRITICAL: rawBody not available for customers/data_request webhook');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!shopDomain || !hmacHeader) {
      console.error('❌ GDPR webhook missing required headers');
      return res.status(401).json({ error: 'Unauthorized - missing headers' });
    }

    // Get integration by domain
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('api_secret_key, webhook_signature')
      .eq('shop_domain', shopDomain)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      console.error('❌ Integration not found for GDPR webhook:', shopDomain);
      return res.status(401).json({ error: 'Unauthorized - integration not found' });
    }

    // SIEMPRE usar .env para HMAC
    const webhookSecret = process.env.SHOPIFY_API_SECRET;

    if (!webhookSecret) {
      console.error('❌ SHOPIFY_API_SECRET not configured in .env');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    console.log('🔐 Using SHOPIFY_API_SECRET from .env for customers/data_request');

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      webhookSecret
    );

    if (!isValid) {
      console.error('❌ Invalid HMAC signature for customers/data_request');
      return res.status(401).json({ error: 'Unauthorized - invalid HMAC' });
    }

    console.log('✅ GDPR customers/data_request webhook received:', req.body);

    // TODO: Implement actual data request handling
    // This should compile customer data and send it to the provided email

    res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('❌ Error processing customers/data_request webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

shopifyRouter.post('/webhook/customers/data_request', customersDataRequestHandler);
shopifyRouter.post('/webhooks/customers/data_request', customersDataRequestHandler);

// POST /api/shopify/webhook/customers/redact OR /webhooks/customers/redact
// Shopify calls this when a customer requests deletion of their data (GDPR compliance)
const customersRedactHandler = async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    // CRITICAL: Must use rawBody from middleware for correct HMAC verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      console.error('❌ CRITICAL: rawBody not available for customers/redact webhook');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!shopDomain || !hmacHeader) {
      console.error('❌ GDPR webhook missing required headers');
      return res.status(401).json({ error: 'Unauthorized - missing headers' });
    }

    // Get integration by domain
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('api_secret_key, webhook_signature')
      .eq('shop_domain', shopDomain)
      .eq('status', 'active')
      .single();

    if (error || !integration) {
      console.error('❌ Integration not found for GDPR webhook:', shopDomain);
      return res.status(401).json({ error: 'Unauthorized - integration not found' });
    }

    // SIEMPRE usar .env para HMAC
    const webhookSecret = process.env.SHOPIFY_API_SECRET;

    if (!webhookSecret) {
      console.error('❌ SHOPIFY_API_SECRET not configured in .env');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    console.log('🔐 Using SHOPIFY_API_SECRET from .env for customers/redact');

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      webhookSecret
    );

    if (!isValid) {
      console.error('❌ Invalid HMAC signature for customers/redact');
      return res.status(401).json({ error: 'Unauthorized - invalid HMAC' });
    }

    console.log('✅ GDPR customers/redact webhook received:', req.body);

    // TODO: Implement actual customer data redaction
    // This should anonymize or delete customer PII from the database

    res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('❌ Error processing customers/redact webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

shopifyRouter.post('/webhook/customers/redact', customersRedactHandler);
shopifyRouter.post('/webhooks/customers/redact', customersRedactHandler);

// POST /api/shopify/webhook/app-uninstalled OR /webhooks/app-uninstalled
// Shopify calls this when the app is uninstalled from a store
const appUninstalledHandler = async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    // CRITICAL: Must use rawBody from middleware for correct HMAC verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      console.error('❌ CRITICAL: rawBody not available for app-uninstalled webhook');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!shopDomain || !hmacHeader) {
      console.error('❌ app/uninstalled webhook missing required headers');
      return res.status(401).json({ error: 'Unauthorized - missing headers' });
    }

    // Get integration by domain
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('api_secret_key, webhook_signature, id')
      .eq('shop_domain', shopDomain)
      .single();

    if (error || !integration) {
      console.error('❌ Integration not found for app/uninstalled webhook:', shopDomain);
      // Return 200 even if integration not found to prevent Shopify retries
      return res.status(200).json({ success: true, message: 'Integration not found' });
    }

    // SIEMPRE usar .env para HMAC
    const webhookSecret = process.env.SHOPIFY_API_SECRET;

    // For app/uninstalled, if credentials are missing, we still want to process the uninstall
    // This can happen if the app was already uninstalled and credentials were revoked
    if (!webhookSecret || webhookSecret.trim() === '') {
      console.warn('⚠️ SHOPIFY_API_SECRET missing in .env for app/uninstalled, processing anyway:', shopDomain);
      console.warn('⚠️ This may indicate the app was already uninstalled or credentials were revoked');
      // Skip HMAC verification and proceed to mark as uninstalled
    } else {
      console.log('🔐 Using SHOPIFY_API_SECRET from .env for app/uninstalled');

      // Verify HMAC signature if secret is available
      const isValid = ShopifyWebhookService.verifyHmacSignature(
        rawBody,
        hmacHeader,
        webhookSecret
      );

      if (!isValid) {
        console.error('❌ Invalid HMAC signature for app/uninstalled');
        return res.status(401).json({ error: 'Unauthorized - invalid HMAC' });
      }
    }

    console.log('✅ app/uninstalled webhook received for shop:', shopDomain);

    // Mark integration as uninstalled
    const { error: updateError } = await supabaseAdmin
      .from('shopify_integrations')
      .update({
        status: 'uninstalled',
        uninstalled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', integration.id);

    if (updateError) {
      console.error('❌ Error marking integration as uninstalled:', updateError);
      throw updateError;
    }

    console.log('✅ Integration marked as uninstalled:', integration.id);

    // Delete all registered webhooks from our database
    const { error: deleteWebhooksError } = await supabaseAdmin
      .from('shopify_webhooks')
      .update({ is_active: false })
      .eq('integration_id', integration.id);

    if (deleteWebhooksError) {
      console.warn('⚠️ Failed to deactivate webhooks:', deleteWebhooksError);
    }

    res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('❌ Error processing app/uninstalled webhook:', error);
    // Return 200 to prevent Shopify from retrying
    res.status(200).json({ success: false, error: 'Internal error' });
  }
};

shopifyRouter.post('/webhook/app-uninstalled', appUninstalledHandler);
shopifyRouter.post('/webhooks/app-uninstalled', appUninstalledHandler);

// POST /api/shopify/webhook/shop/redact OR /webhooks/shop/redact
// Shopify calls this when a shop uninstalls the app (GDPR compliance)
const shopRedactHandler = async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    // CRITICAL: Must use rawBody from middleware for correct HMAC verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      console.error('❌ CRITICAL: rawBody not available for shop/redact webhook');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!shopDomain || !hmacHeader) {
      console.error('❌ GDPR webhook missing required headers');
      return res.status(401).json({ error: 'Unauthorized - missing headers' });
    }

    // Get integration by domain
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('api_secret_key, webhook_signature, store_id')
      .eq('shop_domain', shopDomain)
      .single(); // Don't filter by status - shop may already be inactive

    if (error || !integration) {
      console.error('❌ Integration not found for GDPR webhook:', shopDomain);
      return res.status(401).json({ error: 'Unauthorized - integration not found' });
    }

    // SIEMPRE usar .env para HMAC
    const webhookSecret = process.env.SHOPIFY_API_SECRET;

    if (!webhookSecret) {
      console.error('❌ SHOPIFY_API_SECRET not configured in .env');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    console.log('🔐 Using SHOPIFY_API_SECRET from .env for shop/redact');

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      webhookSecret
    );

    if (!isValid) {
      console.error('❌ Invalid HMAC signature for shop/redact');
      return res.status(401).json({ error: 'Unauthorized - invalid HMAC' });
    }

    console.log('✅ GDPR shop/redact webhook received:', req.body);

    // TODO: Implement actual shop data redaction
    // This should delete or anonymize all data related to the shop
    // Consider: products, customers, orders, integration config

    res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('❌ Error processing shop/redact webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

shopifyRouter.post('/webhook/shop/redact', shopRedactHandler);
shopifyRouter.post('/webhooks/shop/redact', shopRedactHandler);

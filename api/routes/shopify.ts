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
import { ShopifyIntegration, ShopifyConfigRequest } from '../types/shopify';

export const shopifyRouter = Router();

// Aplicar autenticacion a todas las rutas excepto webhooks
shopifyRouter.use((req: Request, res: Response, next) => {
  if (req.path.startsWith('/webhook/')) {
    return next();
  }
  return verifyToken(req as AuthRequest, res, next);
});

shopifyRouter.use((req: Request, res: Response, next) => {
  if (req.path.startsWith('/webhook/')) {
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
    const importService = new ShopifyImportService(supabase, integration);
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
    const importService = new ShopifyImportService(supabase, integration);
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
    const importService = new ShopifyImportService(supabase, integration);
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

// POST /api/shopify/webhook/orders-create
// Webhook para nuevos pedidos de Shopify (con retry automático y deduplicación)
shopifyRouter.post('/webhook/orders-create', async (req: Request, res: Response) => {
  const startTime = Date.now();
  let integrationId: string | null = null;
  let storeId: string | null = null;

  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = JSON.stringify(req.body);

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
    await webhookManager.recordMetric(integrationId, storeId, 'received');

    // Verificar HMAC
    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      integration.webhook_signature || integration.api_secret_key
    );

    if (!isValid) {
      console.error('❌ Invalid HMAC signature');
      await webhookManager.recordMetric(
        integrationId,
        storeId,
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
        await webhookManager.recordMetric(integrationId, storeId, 'duplicate');
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
      integrationId,
      idempotencyKey
    );

    if (idempotencyCheck.is_duplicate) {
      console.warn(`⚠️ Duplicate webhook: ${idempotencyKey}`);
      await webhookManager.recordMetric(integrationId, storeId, 'duplicate');
      return res.status(200).json({
        success: true,
        message: 'Already processed',
        idempotency_key: idempotencyKey,
      });
    }

    // Process webhook
    const webhookService = new ShopifyWebhookService(supabaseAdmin);
    const result = await webhookService.processOrderCreatedWebhook(
      req.body,
      storeId,
      integrationId
    );

    const processingTime = Date.now() - startTime;

    if (result.success) {
      // Record successful processing
      await webhookManager.recordIdempotency(
        integrationId,
        idempotencyKey,
        orderId,
        'orders/create',
        true,
        200,
        'success'
      );

      await webhookManager.recordMetric(
        integrationId,
        storeId,
        'processed',
        processingTime
      );

      console.log(
        `✅ Webhook processed successfully in ${processingTime}ms: ${orderId}`
      );

      res.json({
        success: true,
        order_id: result.order_id,
        processing_time_ms: processingTime,
      });
    } else {
      // Processing failed - add to retry queue
      console.error('❌ Webhook processing failed:', result.error);

      // Record idempotency as failed (but prevent duplicates)
      await webhookManager.recordIdempotency(
        integrationId,
        idempotencyKey,
        orderId,
        'orders/create',
        false,
        500,
        result.error || 'Processing failed'
      );

      // Add to retry queue if it's a retriable error
      if (result.error !== 'n8n delivery failed') {
        // Don't retry n8n failures
        const { data: webhookEvent } = await supabaseAdmin
          .from('shopify_webhook_events')
          .insert({
            integration_id: integrationId,
            store_id: storeId,
            event_type: 'order',
            shopify_topic: 'orders/create',
            shopify_event_id: orderId,
            payload: req.body,
            headers: {
              'X-Shopify-Shop-Domain': shopDomain,
              'X-Shopify-Hmac-Sha256': hmacHeader,
            },
            processed: false,
            idempotency_key: idempotencyKey,
          })
          .select('id')
          .single();

        if (webhookEvent) {
          await webhookManager.addToRetryQueue(
            integrationId,
            storeId,
            webhookEvent.id,
            'orders/create',
            req.body,
            result.error || 'Unknown error',
            '500'
          );
        }
      }

      await webhookManager.recordMetric(
        integrationId,
        storeId,
        'failed',
        processingTime,
        '500'
      );

      // Return 200 to prevent Shopify from retrying (we handle retries internally)
      res.status(200).json({
        success: false,
        error: 'Processing failed - added to retry queue',
        will_retry: true,
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
});

// POST /api/shopify/webhook/orders-updated
// Webhook para actualizacion de pedidos
shopifyRouter.post('/webhook/orders-updated', async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = JSON.stringify(req.body);

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

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      integration.webhook_signature || integration.api_secret_key
    );

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    const webhookService = new ShopifyWebhookService(supabase);
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
});

// POST /api/shopify/webhook/products-delete
// Webhook para productos eliminados en Shopify
shopifyRouter.post('/webhook/products-delete', async (req: Request, res: Response) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = JSON.stringify(req.body);

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

    const isValid = ShopifyWebhookService.verifyHmacSignature(
      rawBody,
      hmacHeader,
      integration.webhook_signature || integration.api_secret_key
    );

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    const webhookService = new ShopifyWebhookService(supabase);
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
});

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
        const syncService = new ShopifyProductSyncService(supabase, integration);
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
      const syncService = new ShopifyProductSyncService(supabase, integration);
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

// GET /api/shopify/integration
// Obtener configuracion actual de Shopify
shopifyRouter.get('/integration', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, shop_domain, shop_name, status, import_products, import_customers, import_orders, import_historical_orders, last_sync_at, shop_data')
      .eq('store_id', storeId)
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
    let issues: string[] = [];

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

    res.json({
      success: true,
      deleted_keys: deleted,
      message: `Cleaned up ${deleted} expired idempotency keys`
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

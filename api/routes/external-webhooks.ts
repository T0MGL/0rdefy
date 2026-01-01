/**
 * External Webhooks API Routes
 *
 * Endpoints para gestionar webhooks externos y recibir pedidos
 * desde landing pages y sistemas externos.
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId } from '../middleware/auth';
import { externalWebhookService, ExternalOrderPayload } from '../services/external-webhook.service';

export const externalWebhooksRouter = Router();

// ============================================================================
// MIDDLEWARE - Separar rutas públicas de protegidas
// ============================================================================

externalWebhooksRouter.use((req, res, next) => {
  // La ruta de recepción de pedidos es pública (usa API Key)
  if (req.path.startsWith('/orders/')) {
    return next();
  }

  // El resto de rutas requieren autenticación JWT
  return verifyToken(req, res, () => {
    extractStoreId(req, res, next);
  });
});

// ============================================================================
// RUTAS DE GESTIÓN (Autenticadas con JWT)
// ============================================================================

/**
 * GET /api/external-webhooks/config
 * Obtener configuración del webhook para la tienda actual
 */
externalWebhooksRouter.get('/config', async (req: any, res: Response) => {
  try {
    const { storeId } = req;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const config = await externalWebhookService.getConfig(storeId);

    if (!config) {
      // Return 200 with success: false to avoid console errors in browser
      return res.status(200).json({
        success: false,
        error: 'not_configured',
        message: 'External webhook not configured for this store'
      });
    }

    // No devolver el API Key completo por seguridad
    const safeConfig = {
      ...config,
      api_key: undefined, // No exponer el API Key completo
      webhook_url: `${process.env.API_BASE_URL || 'https://api.ordefy.io'}/api/webhook/orders/${storeId}`
    };

    return res.json({
      success: true,
      config: safeConfig
    });
  } catch (error: any) {
    console.error('[ExternalWebhooks] Error getting config:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get webhook configuration'
    });
  }
});

/**
 * POST /api/external-webhooks/setup
 * Crear o habilitar el webhook para la tienda
 */
externalWebhooksRouter.post('/setup', async (req: any, res: Response) => {
  try {
    const { storeId, userId } = req;
    const { name, description, autoConfirm } = req.body;

    if (!storeId || !userId) {
      return res.status(400).json({ error: 'Store ID and User ID are required' });
    }

    // Verificar si ya existe
    const existing = await externalWebhookService.getConfig(storeId);
    if (existing) {
      // Si existe pero está inactivo, reactivar
      if (!existing.is_active) {
        const result = await externalWebhookService.regenerateApiKey(storeId);
        if ('error' in result) {
          return res.status(500).json({ error: result.error });
        }

        // Reactivar
        await supabaseAdmin
          .from('external_webhook_configs')
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq('store_id', storeId);

        return res.json({
          success: true,
          message: 'Webhook reactivated with new API key',
          webhook_url: `${process.env.API_BASE_URL || 'https://api.ordefy.io'}/api/webhook/orders/${storeId}`,
          api_key: result.apiKey
        });
      }

      return res.status(400).json({
        error: 'already_configured',
        message: 'External webhook already configured for this store'
      });
    }

    // Crear nueva configuración
    const result = await externalWebhookService.createConfig(storeId, userId, {
      name,
      description,
      autoConfirm
    });

    if ('error' in result) {
      return res.status(500).json({ error: result.error });
    }

    console.log(`[ExternalWebhooks] Created webhook for store ${storeId}`);

    return res.status(201).json({
      success: true,
      message: 'Webhook configured successfully',
      webhook_url: `${process.env.API_BASE_URL || 'https://api.ordefy.io'}/api/webhook/orders/${storeId}`,
      api_key: result.apiKey,
      config: {
        id: result.config.id,
        name: result.config.name,
        is_active: result.config.is_active,
        auto_confirm_orders: result.config.auto_confirm_orders
      }
    });
  } catch (error: any) {
    console.error('[ExternalWebhooks] Error in setup:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to configure webhook'
    });
  }
});

/**
 * POST /api/external-webhooks/regenerate-key
 * Regenerar el API Key del webhook
 */
externalWebhooksRouter.post('/regenerate-key', async (req: any, res: Response) => {
  try {
    const { storeId } = req;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    // Verificar que existe
    const existing = await externalWebhookService.getConfig(storeId);
    if (!existing) {
      return res.status(404).json({
        error: 'not_configured',
        message: 'External webhook not configured for this store'
      });
    }

    const result = await externalWebhookService.regenerateApiKey(storeId);

    if ('error' in result) {
      return res.status(500).json({ error: result.error });
    }

    console.log(`[ExternalWebhooks] Regenerated API key for store ${storeId}`);

    return res.json({
      success: true,
      message: 'API key regenerated successfully',
      api_key: result.apiKey
    });
  } catch (error: any) {
    console.error('[ExternalWebhooks] Error regenerating key:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to regenerate API key'
    });
  }
});

/**
 * DELETE /api/external-webhooks/config
 * Desactivar o eliminar el webhook
 */
externalWebhooksRouter.delete('/config', async (req: any, res: Response) => {
  try {
    const { storeId } = req;
    const { permanent } = req.query;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    if (permanent === 'true') {
      // Eliminación permanente
      const result = await externalWebhookService.deleteConfig(storeId);
      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      console.log(`[ExternalWebhooks] Deleted webhook for store ${storeId}`);
      return res.json({
        success: true,
        message: 'Webhook configuration deleted permanently'
      });
    } else {
      // Solo desactivar
      const result = await externalWebhookService.disableWebhook(storeId);
      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      console.log(`[ExternalWebhooks] Disabled webhook for store ${storeId}`);
      return res.json({
        success: true,
        message: 'Webhook disabled'
      });
    }
  } catch (error: any) {
    console.error('[ExternalWebhooks] Error deleting config:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to delete webhook configuration'
    });
  }
});

/**
 * GET /api/external-webhooks/logs
 * Obtener logs de actividad del webhook
 */
externalWebhooksRouter.get('/logs', async (req: any, res: Response) => {
  try {
    const { storeId } = req;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const result = await externalWebhookService.getLogs(storeId, page, limit);

    return res.json({
      success: true,
      ...result
    });
  } catch (error: any) {
    console.error('[ExternalWebhooks] Error getting logs:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get webhook logs'
    });
  }
});

/**
 * GET /api/external-webhooks/logs/:logId
 * Obtener detalles de un log específico
 */
externalWebhooksRouter.get('/logs/:logId', async (req: any, res: Response) => {
  try {
    const { storeId } = req;
    const { logId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const log = await externalWebhookService.getLogById(logId, storeId);

    if (!log) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Log not found'
      });
    }

    return res.json({
      success: true,
      log
    });
  } catch (error: any) {
    console.error('[ExternalWebhooks] Error getting log:', error);
    return res.status(500).json({
      error: 'server_error',
      message: 'Failed to get log details'
    });
  }
});

/**
 * GET /api/external-webhooks/payload-example
 * Obtener ejemplo del payload esperado
 */
externalWebhooksRouter.get('/payload-example', async (req: any, res: Response) => {
  const example: ExternalOrderPayload = {
    idempotency_key: 'order-unique-id-123',

    customer: {
      name: 'Juan Pérez',
      email: 'juan@email.com',
      phone: '+595981123456'
    },

    shipping_address: {
      address: 'Av. España 1234',
      city: 'Asunción',
      country: 'Paraguay',
      reference: 'Casa blanca, enfrente al supermercado',
      notes: 'Entregar después de las 6pm'
    },

    items: [
      {
        name: 'Producto Premium',
        sku: 'SKU-001',
        quantity: 2,
        price: 150000,
        variant_title: 'Talla M'
      }
    ],

    totals: {
      subtotal: 300000,
      shipping: 25000,
      discount: 10000,
      tax: 0,
      total: 315000
    },

    payment_method: 'cash_on_delivery',

    metadata: {
      source: 'landing-page-promo',
      campaign: 'black-friday-2024',
      utm_source: 'facebook'
    }
  };

  return res.json({
    success: true,
    example,
    documentation: {
      required_fields: {
        'customer.name': 'Nombre del cliente',
        'customer.email OR customer.phone': 'Al menos uno es requerido',
        'shipping_address.address': 'Dirección de entrega',
        'shipping_address.city': 'Ciudad',
        'items': 'Array con al menos un producto',
        'items[].name': 'Nombre del producto',
        'items[].quantity': 'Cantidad (mínimo 1)',
        'items[].price': 'Precio unitario',
        'totals.total': 'Total del pedido',
        'payment_method': 'cash_on_delivery | online | pending'
      },
      optional_fields: {
        'idempotency_key': 'ID único para prevenir duplicados (recomendado)',
        'shipping_address.country': 'País (default: Paraguay)',
        'shipping_address.reference': 'Referencia de ubicación (ej: Casa blanca)',
        'shipping_address.notes': 'Instrucciones de entrega',
        'items[].sku': 'SKU para mapear con productos existentes',
        'items[].variant_title': 'Variante del producto',
        'totals.subtotal': 'Subtotal antes de envío/descuentos',
        'totals.shipping': 'Costo de envío',
        'totals.discount': 'Descuento aplicado',
        'totals.tax': 'Impuestos',
        'metadata': 'Datos adicionales (se guardan como JSONB)'
      },
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'Tu API Key proporcionado por Ordefy'
      }
    }
  });
});

// ============================================================================
// RUTA PÚBLICA - Recepción de pedidos (Autenticada con API Key)
// ============================================================================

/**
 * POST /api/webhook/orders/:storeId
 * Recibir pedido desde sistema externo
 *
 * Headers requeridos:
 * - Content-Type: application/json
 * - X-API-Key: API Key del webhook
 *
 * Body: ExternalOrderPayload
 */
externalWebhooksRouter.post('/orders/:storeId', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { storeId } = req.params;

  try {
    // 1. Validar store ID
    if (!storeId || storeId.length !== 36) {
      return res.status(400).json({
        success: false,
        error: 'invalid_store_id',
        message: 'Invalid or missing store ID'
      });
    }

    // 2. Extraer API Key del header
    const apiKey = req.get('X-API-Key') || req.get('x-api-key');
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Missing X-API-Key header'
      });
    }

    // 3. Validar API Key
    const config = await externalWebhookService.validateApiKey(storeId, apiKey);
    if (!config) {
      return res.status(401).json({
        success: false,
        error: 'unauthorized',
        message: 'Invalid API key'
      });
    }

    // 4. Verificar que el webhook esté activo
    if (!config.is_active) {
      return res.status(403).json({
        success: false,
        error: 'webhook_disabled',
        message: 'Webhook is disabled'
      });
    }

    // 5. Obtener información de la petición
    const requestInfo = {
      sourceIp: req.ip || req.get('X-Forwarded-For') || req.socket.remoteAddress,
      userAgent: req.get('User-Agent')
    };

    // 6. Procesar el pedido
    const result = await externalWebhookService.processIncomingOrder(
      req.body as ExternalOrderPayload,
      storeId,
      config,
      requestInfo
    );

    const processingTime = Date.now() - startTime;
    console.log(`[ExternalWebhook] Processed order in ${processingTime}ms:`, {
      storeId,
      success: result.success,
      orderId: result.orderId,
      isDuplicate: result.isDuplicate
    });

    // 7. Responder según el resultado
    if (!result.success) {
      // Validation error
      if (result.error === 'validation_error') {
        return res.status(400).json({
          success: false,
          error: 'validation_error',
          message: 'Invalid payload'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'processing_error',
        message: result.error || 'Failed to process order'
      });
    }

    // Duplicate order
    if (result.isDuplicate) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        order_id: result.orderId,
        message: 'Order already processed'
      });
    }

    // Success
    return res.status(201).json({
      success: true,
      order_id: result.orderId,
      order_number: result.orderNumber,
      customer_id: result.customerId,
      message: 'Order created successfully'
    });

  } catch (error: any) {
    console.error('[ExternalWebhook] Error processing order:', error);
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Internal server error'
    });
  }
});

export default externalWebhooksRouter;

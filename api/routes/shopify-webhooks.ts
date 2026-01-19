// ================================================================
// SHOPIFY WEBHOOK HANDLERS (LEGACY ROUTES)
// ================================================================
// This file provides backwards compatibility for legacy webhook URLs.
// All webhook processing is delegated to ShopifyWebhookService which
// handles the complete data mapping including payment fields.
// ================================================================

import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../db/connection';
import { ShopifyWebhookService } from '../services/shopify-webhook.service';
import { logger } from '../utils/logger';

const router = express.Router();

// ================================================================
// MIDDLEWARE: Webhook Timeout Protection
// ================================================================
// Shopify has a 30s timeout - we must respond before that
// Set 25s timeout to ensure we can respond gracefully
// ================================================================
function webhookTimeout(req: Request, res: Response, next: NextFunction) {
  const WEBHOOK_TIMEOUT = 25000; // 25 seconds
  let timeoutHandled = false;

  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      timeoutHandled = true;
      logger.error('SERVER', `⏱️ [WEBHOOK-TIMEOUT] Request timed out after ${WEBHOOK_TIMEOUT}ms`);
      logger.error('SERVER', `⏱️ [WEBHOOK-TIMEOUT] Topic: ${req.path}, Shop: ${req.headers['x-shopify-shop-domain']}`);

      // Respond with 200 to prevent Shopify retries
      // Log the timeout for monitoring
      res.status(200).send('Timeout - processing in background');
    }
  }, WEBHOOK_TIMEOUT);

  // CRITICAL (M-3 FIX): Clear timeout when response is sent via any method
  // Intercept all response methods to ensure cleanup
  const clearTimeoutSafely = () => {
    if (!timeoutHandled) {
      clearTimeout(timeoutId);
      timeoutHandled = true;
    }
  };

  const originalSend = res.send.bind(res);
  const originalJson = res.json.bind(res);
  const originalEnd = res.end.bind(res);

  res.send = function(data: any) {
    clearTimeoutSafely();
    return originalSend(data);
  };

  res.json = function(data: any) {
    clearTimeoutSafely();
    return originalJson(data);
  };

  res.end = function(...args: any[]) {
    clearTimeoutSafely();
    return originalEnd(...args);
  };

  next();
}

// ================================================================
// MIDDLEWARE: Validate Shopify HMAC signature
// ================================================================
// Shopify signs all webhook requests with HMAC-SHA256
// We must validate this to ensure the request came from Shopify
// For Custom Apps: Uses api_secret_key from database (NOT .env)
// For OAuth Apps: Uses SHOPIFY_API_SECRET from .env
// ================================================================
async function validateShopifyHMAC(req: any, res: Response, next: any) {
  const hmac = req.headers['x-shopify-hmac-sha256'] as string;
  const shopDomain = req.headers['x-shopify-shop-domain'] as string;

  if (!hmac) {
    logger.error('SERVER', '❌ [WEBHOOK] Missing HMAC header');
    return res.status(401).send('Missing HMAC');
  }

  if (!shopDomain) {
    logger.error('SERVER', '❌ [WEBHOOK] Missing shop domain header');
    return res.status(401).send('Missing shop domain');
  }

  // Get integration from database to retrieve correct API secret
  const { data: integration, error: intError } = await supabaseAdmin
    .from('shopify_integrations')
    .select('api_secret_key')
    .eq('shop_domain', shopDomain)
    .single();

  if (intError || !integration) {
    logger.error('SERVER', `❌ [WEBHOOK] Integration not found for ${shopDomain}`);
    return res.status(404).send('Integration not found');
  }

  // Use api_secret_key from database (Custom App) OR fallback to .env (OAuth App)
  const secret = integration.api_secret_key || process.env.SHOPIFY_API_SECRET;

  if (!secret) {
    logger.error('SERVER', '❌ [WEBHOOK] API secret not configured');
    return res.status(500).send('Server configuration error');
  }

  // Use rawBody if available, otherwise stringify the body
  const body = req.rawBody || JSON.stringify(req.body);

  // Generate base64 hash (OAuth/Public Apps)
  const hashBase64 = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');

  // Generate hex hash (Custom Apps created from Shopify Admin)
  const hashHex = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');

  // Shopify always sends HMAC in base64 format (both OAuth and Custom Apps)
  if (hmac === hashBase64) {
    logger.info('SERVER', `✅ [WEBHOOK] HMAC validated (base64) for ${shopDomain}`);
  }
  // Fallback: try hex format (legacy support, rarely used)
  else if (hmac === hashHex) {
    logger.info('SERVER', `✅ [WEBHOOK] HMAC validated (hex - legacy) for ${shopDomain}`);
  }
  // Neither format matched - invalid HMAC
  else {
    logger.error('SERVER', `❌ [WEBHOOK] Invalid HMAC signature for ${shopDomain}`);
    logger.error('SERVER', `🔐 Using secret from: ${integration.api_secret_key ? 'database (Custom App)' : '.env (OAuth App)'}`);
    logger.error('SERVER', `   Expected base64: ${hashBase64.substring(0, 20)}...`);
    logger.error('SERVER', `   Expected hex: ${hashHex.substring(0, 40)}...`);
    logger.error('SERVER', `   Received HMAC: ${hmac.substring(0, 40)}...`);
    return res.status(401).send('Invalid HMAC');
  }

  // ================================================================
  // REPLAY ATTACK PROTECTION
  // ================================================================
  // Reject webhooks older than 5 minutes to prevent replay attacks
  // Shopify webhooks include created_at or updated_at timestamps
  const webhookTimestamp = req.body.created_at || req.body.updated_at;
  if (webhookTimestamp) {
    const webhookDate = new Date(webhookTimestamp);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    if (webhookDate < fiveMinutesAgo) {
      logger.warn('SERVER', `⚠️ [WEBHOOK] Rejected: older than 5 minutes (timestamp: ${webhookTimestamp})`);
      logger.warn('SERVER', `⚠️ [WEBHOOK] This could be a replay attack or network delay`);
      return res.status(200).send('Webhook too old - rejected for security');
    }
  }

  next();
}

// Apply timeout protection and HMAC validation to all webhook routes
router.use(webhookTimeout);
router.use(validateShopifyHMAC);

// ================================================================
// WEBHOOK 1: ORDERS - CREATE
// ================================================================
// Triggered when a new order is created in Shopify
// CRITICAL: Delegates to ShopifyWebhookService for complete data mapping
// including financial_status, cod_amount, payment_gateway, etc.
// ================================================================
router.post('/orders-create', async (req: Request, res: Response) => {
  try {
    const order = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    logger.info('SHOPIFY_WEBHOOK_LEGACY', `📥 New order from ${shopDomain}: #${order.order_number}`);

    // 1. Find integration with access_token for GraphQL enrichment
    const { data: integration, error: intError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id, shop_domain, access_token, api_key, api_secret_key')
      .eq('shop_domain', shopDomain)
      .single();

    if (intError || !integration) {
      logger.error('SHOPIFY_WEBHOOK_LEGACY', `Integration not found for ${shopDomain}`);
      return res.status(404).send('Integration not found');
    }

    // 2. Use ShopifyWebhookService for complete data mapping
    // This ensures financial_status, cod_amount, payment_gateway are all saved
    const webhookService = new ShopifyWebhookService(supabaseAdmin);
    const result = await webhookService.processOrderCreatedWebhook(
      order,
      integration.store_id,
      integration.id,
      {
        shop_domain: integration.shop_domain,
        access_token: integration.access_token,
        api_key: integration.api_key,
        api_secret_key: integration.api_secret_key
      }
    );

    if (!result.success) {
      logger.error('SHOPIFY_WEBHOOK_LEGACY', `Error processing order: ${result.error}`);
      // Still return 200 to prevent Shopify retries - error is logged
      return res.status(200).send('Error logged, webhook acknowledged');
    }

    logger.info('SHOPIFY_WEBHOOK_LEGACY', `✅ Order ${order.order_number} processed successfully (order_id: ${result.order_id})`);
    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('SHOPIFY_WEBHOOK_LEGACY', `Error processing order webhook: ${error.message}`);
    // Return 200 to prevent Shopify infinite retries
    res.status(200).send('Error logged, webhook acknowledged');
  }
});

// ================================================================
// WEBHOOK 2: ORDERS - UPDATED
// ================================================================
// Triggered when an order is updated in Shopify
// CRITICAL: Delegates to ShopifyWebhookService for complete data mapping
// including financial_status updates (e.g., when payment is captured)
// ================================================================
router.post('/orders-updated', async (req: Request, res: Response) => {
  try {
    const order = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    logger.info('SHOPIFY_WEBHOOK_LEGACY', `🔄 Order updated from ${shopDomain}: #${order.order_number}`);

    // Find integration with access_token
    const { data: integration, error: intError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id, shop_domain, access_token, api_key, api_secret_key')
      .eq('shop_domain', shopDomain)
      .single();

    if (intError || !integration) {
      logger.error('SHOPIFY_WEBHOOK_LEGACY', `Integration not found for ${shopDomain}`);
      return res.status(404).send('Integration not found');
    }

    // Use ShopifyWebhookService for complete data mapping
    // This ensures financial_status, cod_amount, payment_gateway are all updated
    const webhookService = new ShopifyWebhookService(supabaseAdmin);
    const result = await webhookService.processOrderUpdatedWebhook(
      order,
      integration.store_id,
      integration.id,
      {
        shop_domain: integration.shop_domain,
        access_token: integration.access_token,
        api_key: integration.api_key,
        api_secret_key: integration.api_secret_key
      }
    );

    if (!result.success) {
      logger.error('SHOPIFY_WEBHOOK_LEGACY', `Error updating order: ${result.error}`);
      return res.status(200).send('Error logged, webhook acknowledged');
    }

    logger.info('SHOPIFY_WEBHOOK_LEGACY', `✅ Order ${order.order_number} updated successfully`);
    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('SHOPIFY_WEBHOOK_LEGACY', `Error processing order update webhook: ${error.message}`);
    res.status(200).send('Error logged, webhook acknowledged');
  }
});

// ================================================================
// WEBHOOK 3: PRODUCTS - CREATE
// ================================================================
// Triggered when a new product is created in Shopify
// ================================================================
router.post('/products-create', async (req: Request, res: Response) => {
  try {
    const product = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    logger.info('SERVER', `✨ [PRODUCT-CREATE] New product: ${product.title} (${product.id})`);

    // Find integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!integration) {
      return res.status(404).send('Integration not found');
    }

    // Create product in database
    const { error } = await supabaseAdmin
      .from('products')
      .insert({
        store_id: integration.store_id,
        name: product.title,
        description: product.body_html,
        shopify_product_id: product.id,
        shop_domain: shopDomain,
        shopify_sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        shopify_data: product
      });

    if (error) throw error;

    logger.info('SERVER', `✅ [PRODUCT-CREATE] Product created: ${product.title}`);

    // Log webhook
    await supabaseAdmin
      .from('shopify_webhook_logs')
      .insert({
        integration_id: integration.id,
        webhook_topic: 'products/create',
        shopify_resource_id: product.id,
        shop_domain: shopDomain,
        status: 'processed',
        processed_at: new Date().toISOString()
      });

    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('SERVER', '❌ [PRODUCT-CREATE] Error:', error);
    // Return 200 to prevent Shopify infinite retries on persistent errors
    res.status(200).send('Error logged, webhook acknowledged');
  }
});

// ================================================================
// WEBHOOK 4: PRODUCTS - UPDATE
// ================================================================
// Triggered when a product is updated in Shopify
// ================================================================
router.post('/products-update', async (req: Request, res: Response) => {
  try {
    const product = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    logger.info('SERVER', `🔄 [PRODUCT-UPDATE] Product updated: ${product.title} (${product.id})`);

    // Find integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!integration) {
      return res.status(404).send('Integration not found');
    }

    // Check if product exists in database
    const { data: existingProduct } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('shopify_product_id', product.id)
      .eq('store_id', integration.store_id)
      .single();

    if (existingProduct) {
      // UPDATE existing product
      const { error } = await supabaseAdmin
        .from('products')
        .update({
          name: product.title,
          description: product.body_html,
          shopify_sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          shopify_data: product
        })
        .eq('id', existingProduct.id);

      if (error) throw error;
      logger.info('SERVER', `✅ [PRODUCT-UPDATE] Product updated: ${product.title}`);

    } else {
      // CREATE new product (in case it wasn't synced before)
      const { error } = await supabaseAdmin
        .from('products')
        .insert({
          store_id: integration.store_id,
          name: product.title,
          description: product.body_html,
          shopify_product_id: product.id,
          shop_domain: shopDomain,
          shopify_sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          shopify_data: product
        });

      if (error) throw error;
      logger.info('SERVER', `✅ [PRODUCT-UPDATE] Product created: ${product.title}`);
    }

    // Log webhook
    await supabaseAdmin
      .from('shopify_webhook_logs')
      .insert({
        integration_id: integration.id,
        webhook_topic: 'products/update',
        shopify_resource_id: product.id,
        shop_domain: shopDomain,
        status: 'processed',
        processed_at: new Date().toISOString()
      });

    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('SERVER', '❌ [PRODUCT-UPDATE] Error:', error);
    // Return 200 to prevent Shopify infinite retries on persistent errors
    res.status(200).send('Error logged, webhook acknowledged');
  }
});

// ================================================================
// WEBHOOK 5: PRODUCTS - DELETE
// ================================================================
// Triggered when a product is deleted in Shopify
// Uses safe_delete_product_by_shopify_id to check dependencies
// ================================================================
router.post('/products-delete', async (req: Request, res: Response) => {
  try {
    const product = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    logger.info('SERVER', `🗑️ [PRODUCT-DELETE] Product deleted in Shopify: ${product.id}`);

    // Find integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!integration) {
      return res.status(404).send('Integration not found');
    }

    // Use safe deletion function that checks for active orders/sessions
    const { data: result, error: rpcError } = await supabaseAdmin
      .rpc('safe_delete_product_by_shopify_id', {
        p_shopify_product_id: product.id.toString(),
        p_store_id: integration.store_id,
        p_force: false // Don't force delete if has dependencies
      });

    if (rpcError) {
      // Fallback to soft delete if RPC not available
      logger.warn('SERVER', `[PRODUCT-DELETE] RPC not available, falling back to soft delete: ${rpcError.message}`);

      const { error: updateError } = await supabaseAdmin
        .from('products')
        .update({
          is_active: false,
          shopify_product_id: null,
          shopify_variant_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('shopify_product_id', product.id)
        .eq('store_id', integration.store_id);

      if (updateError) throw updateError;

      logger.info('SERVER', `✅ [PRODUCT-DELETE] Product soft deleted (fallback)`);
    } else if (result && result.length > 0) {
      const deleteResult = result[0];
      if (deleteResult.success) {
        logger.info('SERVER', `✅ [PRODUCT-DELETE] ${deleteResult.action_taken} (ID: ${deleteResult.deleted_product_id})`);
      } else {
        logger.info('SERVER', `⚠️ [PRODUCT-DELETE] ${deleteResult.action_taken}: ${deleteResult.blocked_reason}`);
      }
    }

    // Log webhook
    await supabaseAdmin
      .from('shopify_webhook_logs')
      .insert({
        integration_id: integration.id,
        webhook_topic: 'products/delete',
        shopify_resource_id: product.id,
        shop_domain: shopDomain,
        status: 'processed',
        processed_at: new Date().toISOString()
      });

    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('SERVER', '❌ [PRODUCT-DELETE] Error:', error);
    // Return 200 to prevent Shopify infinite retries on persistent errors
    res.status(200).send('Error logged, webhook acknowledged');
  }
});

// ================================================================
// WEBHOOK 6: CUSTOMERS - CREATE
// ================================================================
// Triggered when a new customer is created in Shopify
// ================================================================
router.post('/customers-create', async (req: Request, res: Response) => {
  try {
    const customer = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    logger.info('SERVER', `👤 [CUSTOMER-CREATE] New customer: ${customer.email}`);

    // Find integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!integration) {
      return res.status(404).send('Integration not found');
    }

    // Create customer in database
    const customerName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unknown';

    const { error } = await supabaseAdmin
      .from('customers')
      .insert({
        store_id: integration.store_id,
        shopify_customer_id: customer.id,
        name: customerName,
        email: customer.email,
        phone: customer.phone,
        shop_domain: shopDomain,
        last_synced_at: new Date().toISOString()
      });

    // Ignore duplicate key errors
    if (error && !error.message.includes('duplicate')) {
      throw error;
    }

    logger.info('SERVER', `✅ [CUSTOMER-CREATE] Customer created: ${customerName}`);

    // Log webhook
    await supabaseAdmin
      .from('shopify_webhook_logs')
      .insert({
        integration_id: integration.id,
        webhook_topic: 'customers/create',
        shopify_resource_id: customer.id,
        shop_domain: shopDomain,
        status: 'processed',
        processed_at: new Date().toISOString()
      });

    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('SERVER', '❌ [CUSTOMER-CREATE] Error:', error);
    // Return 200 to prevent Shopify infinite retries on persistent errors
    res.status(200).send('Error logged, webhook acknowledged');
  }
});

// ================================================================
// WEBHOOK 7: CUSTOMERS - UPDATE
// ================================================================
// Triggered when a customer is updated in Shopify
// ================================================================
router.post('/customers-update', async (req: Request, res: Response) => {
  try {
    const customer = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    logger.info('SERVER', `👤 [CUSTOMER-UPDATE] Customer updated: ${customer.email}`);

    // Find integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!integration) {
      return res.status(404).send('Integration not found');
    }

    // Upsert customer (create or update)
    const customerName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unknown';

    const { error } = await supabaseAdmin
      .from('customers')
      .upsert({
        store_id: integration.store_id,
        shopify_customer_id: customer.id,
        name: customerName,
        email: customer.email,
        phone: customer.phone,
        shop_domain: shopDomain,
        last_synced_at: new Date().toISOString()
      }, {
        onConflict: 'shopify_customer_id,store_id'
      });

    if (error) throw error;

    logger.info('SERVER', `✅ [CUSTOMER-UPDATE] Customer synced: ${customerName}`);

    // Log webhook
    await supabaseAdmin
      .from('shopify_webhook_logs')
      .insert({
        integration_id: integration.id,
        webhook_topic: 'customers/update',
        shopify_resource_id: customer.id,
        shop_domain: shopDomain,
        status: 'processed',
        processed_at: new Date().toISOString()
      });

    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('SERVER', '❌ [CUSTOMER-UPDATE] Error:', error);
    // Return 200 to prevent Shopify infinite retries on persistent errors
    res.status(200).send('Error logged, webhook acknowledged');
  }
});

// ================================================================
// WEBHOOK 8: APP - UNINSTALLED
// ================================================================
// Triggered when the app is uninstalled from Shopify
// Deactivates integration and clears sensitive data
// ================================================================
router.post('/app-uninstalled', async (req: Request, res: Response) => {
  try {
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    logger.info('SERVER', `❌ [APP-UNINSTALLED] App removed from ${shopDomain}`);

    // Find integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!integration) {
      return res.status(404).send('Integration not found');
    }

    // Mark as inactive and clear sensitive data
    const { error } = await supabaseAdmin
      .from('shopify_integrations')
      .update({
        status: 'inactive',
        access_token: null,
        scope: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', integration.id);

    if (error) throw error;

    // Deactivate all webhooks
    await supabaseAdmin
      .from('shopify_webhooks')
      .update({ is_active: false })
      .eq('integration_id', integration.id);

    logger.info('SERVER', `✅ [APP-UNINSTALLED] Integration deactivated for ${shopDomain}`);

    res.status(200).send('OK');

  } catch (error: any) {
    logger.error('SERVER', '❌ [APP-UNINSTALLED] Error:', error);
    // Return 200 to prevent Shopify infinite retries on persistent errors
    res.status(200).send('Error logged, webhook acknowledged');
  }
});

export default router;

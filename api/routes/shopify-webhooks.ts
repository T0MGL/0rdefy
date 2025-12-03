// ================================================================
// SHOPIFY WEBHOOK HANDLERS
// ================================================================
// Processes webhooks from Shopify for real-time synchronization
// All webhooks require HMAC signature validation
// ================================================================

import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../db/connection';

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
      console.error(`⏱️ [WEBHOOK-TIMEOUT] Request timed out after ${WEBHOOK_TIMEOUT}ms`);
      console.error(`⏱️ [WEBHOOK-TIMEOUT] Topic: ${req.path}, Shop: ${req.headers['x-shopify-shop-domain']}`);

      // Respond with 200 to prevent Shopify retries
      // Log the timeout for monitoring
      res.status(200).send('Timeout - processing in background');
    }
  }, WEBHOOK_TIMEOUT);

  // Clear timeout when response is sent
  const originalSend = res.send.bind(res);
  res.send = function(data: any) {
    if (!timeoutHandled) {
      clearTimeout(timeoutId);
    }
    return originalSend(data);
  };

  next();
}

// ================================================================
// MIDDLEWARE: Validate Shopify HMAC signature
// ================================================================
// Shopify signs all webhook requests with HMAC-SHA256
// We must validate this to ensure the request came from Shopify
// ================================================================
function validateShopifyHMAC(req: any, res: Response, next: any) {
  const hmac = req.headers['x-shopify-hmac-sha256'] as string;

  if (!hmac) {
    console.error('❌ [WEBHOOK] Missing HMAC header');
    return res.status(401).send('Missing HMAC');
  }

  if (!process.env.SHOPIFY_API_SECRET) {
    console.error('❌ [WEBHOOK] SHOPIFY_API_SECRET not configured');
    return res.status(500).send('Server configuration error');
  }

  // Use rawBody if available, otherwise stringify the body
  const body = req.rawBody || JSON.stringify(req.body);

  // Calculate HMAC-SHA256 hash
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  // Timing-safe comparison to prevent timing attacks
  const expectedBuffer = Buffer.from(hash, 'base64');
  const receivedBuffer = Buffer.from(hmac, 'base64');

  // Ensure buffers are same length before comparing
  if (expectedBuffer.length !== receivedBuffer.length) {
    console.error('❌ [WEBHOOK] Invalid HMAC signature (length mismatch)');
    return res.status(401).send('Invalid HMAC');
  }

  // Use timing-safe comparison
  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    console.error('❌ [WEBHOOK] Invalid HMAC signature');
    return res.status(401).send('Invalid HMAC');
  }

  console.log('✅ [WEBHOOK] HMAC validated successfully');

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
      console.warn(`⚠️ [WEBHOOK] Rejected: older than 5 minutes (timestamp: ${webhookTimestamp})`);
      console.warn(`⚠️ [WEBHOOK] This could be a replay attack or network delay`);
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
// Creates new customer if needed, saves order, sends to n8n
// ================================================================
router.post('/orders-create', async (req: Request, res: Response) => {
  try {
    const order = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    console.log(`📥 [ORDER-CREATE] New order from ${shopDomain}: #${order.order_number}`);

    // 1. Find integration
    const { data: integration, error: intError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id')
      .eq('shop_domain', shopDomain)
      .single();

    if (intError || !integration) {
      console.error(`❌ [ORDER-CREATE] Integration not found for ${shopDomain}`);
      return res.status(404).send('Integration not found');
    }

    // 2. Create customer if doesn't exist
    if (order.customer) {
      const { data: existingCustomer } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('shopify_customer_id', order.customer.id)
        .eq('store_id', integration.store_id)
        .single();

      if (!existingCustomer) {
        const customerName = `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || 'Unknown';

        const { error: customerError } = await supabaseAdmin
          .from('customers')
          .insert({
            store_id: integration.store_id,
            shopify_customer_id: order.customer.id,
            name: customerName,
            email: order.customer.email,
            phone: order.customer.phone,
            shop_domain: shopDomain,
            last_synced_at: new Date().toISOString()
          });

        if (customerError) {
          console.error('❌ [ORDER-CREATE] Error creating customer:', customerError);
        } else {
          console.log(`✅ [ORDER-CREATE] New customer created: ${customerName}`);
        }
      }
    }

    // 3. Save order to database
    const customerName = order.customer
      ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
      : 'Unknown';

    const { data: savedOrder, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        store_id: integration.store_id,
        shopify_order_id: order.id,
        shopify_order_number: String(order.order_number),
        customer_name: customerName,
        customer_email: order.customer?.email,
        customer_phone: order.customer?.phone,
        total_price: parseFloat(order.total_price) || 0,
        currency: order.currency || 'USD',
        status: 'pending',
        shop_domain: shopDomain,
        shopify_data: order,
        synced_at: new Date().toISOString()
      })
      .select()
      .single();

    if (orderError) {
      console.error('❌ [ORDER-CREATE] Error saving order:', orderError);
      throw orderError;
    }

    console.log(`✅ [ORDER-CREATE] Order saved: #${order.order_number}`);

    // 4. Log webhook processing
    await supabaseAdmin
      .from('shopify_webhook_logs')
      .insert({
        integration_id: integration.id,
        webhook_topic: 'orders/create',
        shopify_resource_id: order.id,
        shop_domain: shopDomain,
        status: 'processed',
        processed_at: new Date().toISOString()
      });

    // 5. Send to n8n for WhatsApp confirmation (multitenant)
    if (process.env.N8N_WEBHOOK_URL_NEWORDER) {
      try {
        const n8nPayload = {
          store_id: integration.store_id,
          shop_domain: shopDomain,
          customer_name: customerName,
          customer_phone: order.customer?.phone,
          customer_email: order.customer?.email,
          order_id: savedOrder.id,
          shopify_order_id: order.id,
          order_number: order.number,
          total: order.total_price,
          currency: order.currency,
          products: order.line_items?.map((item: any) => ({
            name: item.title,
            quantity: item.quantity,
            price: item.price
          })) || []
        };

        // Add timeout to prevent hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const n8nResponse = await fetch(process.env.N8N_WEBHOOK_URL_NEWORDER, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(n8nPayload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!n8nResponse.ok) {
          throw new Error(`n8n returned ${n8nResponse.status}: ${n8nResponse.statusText}`);
        }

        console.log(`📤 [ORDER-CREATE] Sent to n8n for WhatsApp confirmation`);
      } catch (n8nError: any) {
        console.error('❌ [ORDER-CREATE] Error sending to n8n:', n8nError);

        // Log to webhook_errors table for monitoring
        await supabaseAdmin
          .from('shopify_webhook_logs')
          .insert({
            integration_id: integration.id,
            webhook_topic: 'orders/create',
            shopify_resource_id: order.id,
            shop_domain: shopDomain,
            status: 'n8n_failed',
            error_message: n8nError.message || 'Unknown error',
            processed_at: new Date().toISOString()
          });

        // Don't fail the webhook if n8n fails - order is already saved
        // But we should monitor this metric
      }
    } else {
      console.warn('⚠️ [ORDER-CREATE] N8N_WEBHOOK_URL_NEWORDER not configured');
    }

    res.status(200).send('OK');

  } catch (error: any) {
    console.error('❌ [ORDER-CREATE] Error:', error);
    res.status(500).send('Error processing order');
  }
});

// ================================================================
// WEBHOOK 2: ORDERS - UPDATED
// ================================================================
// Triggered when an order is updated in Shopify
// ================================================================
router.post('/orders-updated', async (req: Request, res: Response) => {
  try {
    const order = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    console.log(`🔄 [ORDER-UPDATED] Order updated: #${order.order_number}`);

    // Find integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!integration) {
      return res.status(404).send('Integration not found');
    }

    // Update order in database
    const { error } = await supabaseAdmin
      .from('orders')
      .update({
        total_price: parseFloat(order.total_price) || 0,
        shopify_data: order,
        synced_at: new Date().toISOString()
      })
      .eq('shopify_order_id', order.id)
      .eq('store_id', integration.store_id);

    if (error) throw error;

    console.log(`✅ [ORDER-UPDATED] Order updated: #${order.order_number}`);

    // Log webhook
    await supabaseAdmin
      .from('shopify_webhook_logs')
      .insert({
        integration_id: integration.id,
        webhook_topic: 'orders/updated',
        shopify_resource_id: order.id,
        shop_domain: shopDomain,
        status: 'processed',
        processed_at: new Date().toISOString()
      });

    res.status(200).send('OK');

  } catch (error: any) {
    console.error('❌ [ORDER-UPDATED] Error:', error);
    res.status(500).send('Error processing order update');
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

    console.log(`✨ [PRODUCT-CREATE] New product: ${product.title} (${product.id})`);

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

    console.log(`✅ [PRODUCT-CREATE] Product created: ${product.title}`);

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
    console.error('❌ [PRODUCT-CREATE] Error:', error);
    res.status(500).send('Error processing product creation');
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

    console.log(`🔄 [PRODUCT-UPDATE] Product updated: ${product.title} (${product.id})`);

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
      console.log(`✅ [PRODUCT-UPDATE] Product updated: ${product.title}`);

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
      console.log(`✅ [PRODUCT-UPDATE] Product created: ${product.title}`);
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
    console.error('❌ [PRODUCT-UPDATE] Error:', error);
    res.status(500).send('Error processing product update');
  }
});

// ================================================================
// WEBHOOK 5: PRODUCTS - DELETE
// ================================================================
// Triggered when a product is deleted in Shopify
// ================================================================
router.post('/products-delete', async (req: Request, res: Response) => {
  try {
    const product = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    console.log(`🗑️ [PRODUCT-DELETE] Product deleted: ${product.id}`);

    // Find integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id')
      .eq('shop_domain', shopDomain)
      .single();

    if (!integration) {
      return res.status(404).send('Integration not found');
    }

    // Delete product from database
    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('shopify_product_id', product.id)
      .eq('store_id', integration.store_id);

    if (error) throw error;

    console.log(`✅ [PRODUCT-DELETE] Product removed from database`);

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
    console.error('❌ [PRODUCT-DELETE] Error:', error);
    res.status(500).send('Error processing product deletion');
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

    console.log(`👤 [CUSTOMER-CREATE] New customer: ${customer.email}`);

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

    console.log(`✅ [CUSTOMER-CREATE] Customer created: ${customerName}`);

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
    console.error('❌ [CUSTOMER-CREATE] Error:', error);
    res.status(500).send('Error processing customer creation');
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

    console.log(`👤 [CUSTOMER-UPDATE] Customer updated: ${customer.email}`);

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

    console.log(`✅ [CUSTOMER-UPDATE] Customer synced: ${customerName}`);

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
    console.error('❌ [CUSTOMER-UPDATE] Error:', error);
    res.status(500).send('Error processing customer update');
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

    console.log(`❌ [APP-UNINSTALLED] App removed from ${shopDomain}`);

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

    console.log(`✅ [APP-UNINSTALLED] Integration deactivated for ${shopDomain}`);

    res.status(200).send('OK');

  } catch (error: any) {
    console.error('❌ [APP-UNINSTALLED] Error:', error);
    res.status(500).send('Error processing app uninstall');
  }
});

export default router;

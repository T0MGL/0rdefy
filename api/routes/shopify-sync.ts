// ================================================================
// SHOPIFY SYNC ROUTES
// ================================================================
// Handles bidirectional sync between Shopify and Ordefy
// Products & Customers only (Orders managed 100% in Ordefy)
//
// Security: Requires INTEGRATIONS module access
// Roles with access: owner, admin
// ================================================================

import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule } from '../middleware/permissions';
import { Module } from '../permissions';
import { ShopifyClientService } from '../services/shopify-client.service';

export const shopifySyncRouter = Router();

// Apply auth middleware to all routes
shopifySyncRouter.use(verifyToken, extractStoreId, extractUserRole);

// Shopify sync requires INTEGRATIONS module access
shopifySyncRouter.use(requireModule(Module.INTEGRATIONS));

// ================================================================
// HELPER: Get Shopify Integration
// ================================================================
const getShopifyIntegration = async (storeId: string) => {
  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .select('*')
    .eq('store_id', storeId)
    .eq('status', 'active')
    .single();

  if (error || !data) {
    throw new Error('Shopify integration not found or inactive');
  }

  return data;
};

// ================================================================
// HELPER: Create Sync Log
// ================================================================
const createSyncLog = async (storeId: string, syncType: string, direction: string) => {
  const { data, error } = await supabaseAdmin
    .from('shopify_sync_logs')
    .insert([{
      store_id: storeId,
      sync_type: syncType,
      direction,
      status: 'running',
      items_processed: 0,
      items_success: 0,
      items_failed: 0,
      started_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (error) throw error;
  return data.id;
};

// ================================================================
// HELPER: Update Sync Log
// ================================================================
const updateSyncLog = async (
  logId: string,
  status: string,
  processed: number,
  success: number,
  failed: number,
  errors?: any[]
) => {
  const startedAt = new Date();
  await supabaseAdmin
    .from('shopify_sync_logs')
    .update({
      status,
      items_processed: processed,
      items_success: success,
      items_failed: failed,
      error_details: errors || null,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
    })
    .eq('id', logId);
};

// ================================================================
// POST /sync/products - Import products from Shopify
// ================================================================
shopifySyncRouter.post('/sync/products', async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  let logId: string | null = null;

  try {
    console.log('📦 [SHOPIFY SYNC] Starting products import...');

    // Get Shopify integration
    const integration = await getShopifyIntegration(req.storeId!);
    const shopifyClient = new ShopifyClientService(integration);

    // Create sync log
    logId = await createSyncLog(req.storeId!, 'products', 'import');

    // Fetch all products from Shopify (using GraphQL)
    const shopifyProducts = await shopifyClient.getAllProducts();
    console.log(`📦 [SHOPIFY SYNC] Fetched ${shopifyProducts.length} products from Shopify`);

    let synced = 0;
    let skipped = 0;
    const errors: any[] = [];

    // Process each product
    for (const shopifyProduct of shopifyProducts) {
      try {
        // Map Shopify product to Ordefy format
        const variant = shopifyProduct.variants[0]; // Use first variant
        const image = shopifyProduct.images[0]?.src || null;

        const ordefyProduct = {
          store_id: req.storeId,
          name: shopifyProduct.title,
          description: shopifyProduct.body_html || '',
          price: parseFloat(variant.price) || 0,
          cost: 0, // Not available in Shopify API
          stock: variant.inventory_quantity || 0,
          image_url: image,
          shopify_product_id: shopifyProduct.id.toString(),
          shopify_variant_id: variant.id.toString(),
          sku: variant.sku || null,
          category: shopifyProduct.product_type || null,
          is_active: shopifyProduct.status === 'active',
          modified_by: 'shopify_sync',
        };

        // Upsert product (update if exists, insert if new)
        const { error: upsertError } = await supabaseAdmin
          .from('products')
          .upsert(ordefyProduct, {
            onConflict: 'shopify_product_id',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          throw upsertError;
        }

        synced++;

        // Log progress every 10 items
        if (synced % 10 === 0) {
          console.log(`📦 [SHOPIFY SYNC] Progress: ${synced}/${shopifyProducts.length} products`);
        }
      } catch (error: any) {
        console.error(`❌ [SHOPIFY SYNC] Error syncing product ${shopifyProduct.id}:`, error);
        errors.push({
          product_id: shopifyProduct.id,
          product_name: shopifyProduct.title,
          error: error.message,
        });
        skipped++;
      }
    }

    // Update sync config
    await supabaseAdmin
      .from('shopify_sync_config')
      .upsert({
        user_id: req.userId,
        store_id: req.storeId,
        last_sync_products: new Date().toISOString(),
        products_synced_count: synced,
      }, {
        onConflict: 'user_id,store_id',
      });

    // Update sync log
    if (logId) {
      await updateSyncLog(logId, 'completed', shopifyProducts.length, synced, skipped, errors);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ [SHOPIFY SYNC] Products sync completed in ${duration}ms`);
    console.log(`📊 [SHOPIFY SYNC] Synced: ${synced}, Skipped: ${skipped}`);

    res.json({
      success: true,
      synced,
      skipped,
      errors,
      duration_ms: duration,
    });
  } catch (error: any) {
    console.error('💥 [SHOPIFY SYNC] Products sync failed:', error);

    if (logId) {
      await updateSyncLog(logId, 'failed', 0, 0, 0, [{ error: error.message }]);
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================================================================
// POST /sync/customers - Import customers from Shopify
// ================================================================
shopifySyncRouter.post('/sync/customers', async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  let logId: string | null = null;

  try {
    console.log('👥 [SHOPIFY SYNC] Starting customers import...');

    // Get Shopify integration
    const integration = await getShopifyIntegration(req.storeId!);
    const shopifyClient = new ShopifyClientService(integration);

    // Create sync log
    logId = await createSyncLog(req.storeId!, 'customers', 'import');

    // Fetch all customers from Shopify (REST API - not deprecated)
    let shopifyCustomers: any[] = [];
    let pageInfo: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const result = await shopifyClient.getCustomers({ limit: 250, page_info: pageInfo });
      shopifyCustomers = [...shopifyCustomers, ...result.customers];
      pageInfo = result.pagination.next_cursor;
      hasMore = result.pagination.has_next;
    }
    console.log(`👥 [SHOPIFY SYNC] Fetched ${shopifyCustomers.length} customers from Shopify`);

    let synced = 0;
    let skipped = 0;
    const errors: any[] = [];

    // Process each customer
    for (const shopifyCustomer of shopifyCustomers) {
      try {
        // Skip customers without email (required in Ordefy)
        if (!shopifyCustomer.email) {
          console.warn(`⚠️  [SHOPIFY SYNC] Skipping customer ${shopifyCustomer.id}: no email`);
          skipped++;
          continue;
        }

        const ordefyCustomer = {
          store_id: req.storeId,
          shopify_customer_id: shopifyCustomer.id.toString(),
          email: shopifyCustomer.email,
          phone: shopifyCustomer.phone || null,
          first_name: shopifyCustomer.first_name || '',
          last_name: shopifyCustomer.last_name || '',
          total_orders: shopifyCustomer.orders_count || 0,
          total_spent: parseFloat(shopifyCustomer.total_spent) || 0,
        };

        // Upsert customer
        const { error: upsertError } = await supabaseAdmin
          .from('customers')
          .upsert(ordefyCustomer, {
            onConflict: 'shopify_customer_id',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          throw upsertError;
        }

        synced++;

        // Log progress every 10 items
        if (synced % 10 === 0) {
          console.log(`👥 [SHOPIFY SYNC] Progress: ${synced}/${shopifyCustomers.length} customers`);
        }
      } catch (error: any) {
        console.error(`❌ [SHOPIFY SYNC] Error syncing customer ${shopifyCustomer.id}:`, error);
        errors.push({
          customer_id: shopifyCustomer.id,
          customer_email: shopifyCustomer.email,
          error: error.message,
        });
        skipped++;
      }
    }

    // Update sync config
    await supabaseAdmin
      .from('shopify_sync_config')
      .upsert({
        user_id: req.userId,
        store_id: req.storeId,
        last_sync_customers: new Date().toISOString(),
        customers_synced_count: synced,
      }, {
        onConflict: 'user_id,store_id',
      });

    // Update sync log
    if (logId) {
      await updateSyncLog(logId, 'completed', shopifyCustomers.length, synced, skipped, errors);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ [SHOPIFY SYNC] Customers sync completed in ${duration}ms`);
    console.log(`📊 [SHOPIFY SYNC] Synced: ${synced}, Skipped: ${skipped}`);

    res.json({
      success: true,
      synced,
      skipped,
      errors,
      duration_ms: duration,
    });
  } catch (error: any) {
    console.error('💥 [SHOPIFY SYNC] Customers sync failed:', error);

    if (logId) {
      await updateSyncLog(logId, 'failed', 0, 0, 0, [{ error: error.message }]);
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================================================================
// POST /sync/inventory - Update Shopify inventory from Ordefy
// ================================================================
shopifySyncRouter.post('/sync/inventory', async (req: AuthRequest, res: Response) => {
  const startTime = Date.now();
  let logId: string | null = null;

  try {
    console.log('📊 [SHOPIFY SYNC] Starting inventory sync...');

    // Get Shopify integration
    const integration = await getShopifyIntegration(req.storeId!);
    const shopifyClient = new ShopifyClientService(integration);

    // Create sync log
    logId = await createSyncLog(req.storeId!, 'inventory', 'export');

    // Get all products with Shopify IDs
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('store_id', req.storeId)
      .not('shopify_variant_id', 'is', null);

    if (productsError) throw productsError;

    if (!products || products.length === 0) {
      return res.json({
        success: true,
        message: 'No products with Shopify IDs found',
        synced: 0,
      });
    }

    console.log(`📊 [SHOPIFY SYNC] Updating ${products.length} product inventories...`);

    let synced = 0;
    let skipped = 0;
    const errors: any[] = [];

    for (const product of products) {
      try {
        // Note: shopify_variant_id is actually the inventory_item_id for inventory updates
        await shopifyClient.updateInventory(product.shopify_variant_id, product.stock);
        synced++;

        if (synced % 10 === 0) {
          console.log(`📊 [SHOPIFY SYNC] Progress: ${synced}/${products.length} inventories`);
        }
      } catch (error: any) {
        console.error(`❌ [SHOPIFY SYNC] Error updating inventory for ${product.name}:`, error);
        errors.push({
          product_id: product.id,
          product_name: product.name,
          error: error.message,
        });
        skipped++;
      }
    }

    // Update sync log
    if (logId) {
      await updateSyncLog(logId, 'completed', products.length, synced, skipped, errors);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ [SHOPIFY SYNC] Inventory sync completed in ${duration}ms`);

    res.json({
      success: true,
      synced,
      skipped,
      errors,
      duration_ms: duration,
    });
  } catch (error: any) {
    console.error('💥 [SHOPIFY SYNC] Inventory sync failed:', error);

    if (logId) {
      await updateSyncLog(logId, 'failed', 0, 0, 0, [{ error: error.message }]);
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ================================================================
// GET /sync/status - Get sync status and configuration
// ================================================================
shopifySyncRouter.get('/sync/status', async (req: AuthRequest, res: Response) => {
  try {
    // Get integration
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('shop, installed_at, status')
      .eq('store_id', req.storeId)
      .single();

    // Get sync config
    const { data: config } = await supabaseAdmin
      .from('shopify_sync_config')
      .select('*')
      .eq('store_id', req.storeId)
      .single();

    // Get recent sync logs
    const { data: recentLogs } = await supabaseAdmin
      .from('shopify_sync_logs')
      .select('*')
      .eq('store_id', req.storeId)
      .order('created_at', { ascending: false })
      .limit(5);

    res.json({
      connected: !!integration && integration.status === 'active',
      shop: integration?.shop,
      installed_at: integration?.installed_at,
      config: config || {
        auto_sync_inventory: false,
        sync_frequency: 'manual',
        last_sync_products: null,
        last_sync_customers: null,
        products_synced_count: 0,
        customers_synced_count: 0,
      },
      recent_logs: recentLogs || [],
    });
  } catch (error: any) {
    console.error('❌ [SHOPIFY SYNC] Error getting status:', error);
    res.status(500).json({
      error: error.message,
    });
  }
});

// ================================================================
// POST /sync/config - Update sync configuration
// ================================================================
shopifySyncRouter.post('/sync/config', async (req: AuthRequest, res: Response) => {
  try {
    const { auto_sync_inventory, sync_frequency } = req.body;

    const { error } = await supabaseAdmin
      .from('shopify_sync_config')
      .upsert({
        user_id: req.userId,
        store_id: req.storeId,
        auto_sync_inventory: auto_sync_inventory ?? false,
        sync_frequency: sync_frequency || 'manual',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,store_id',
      });

    if (error) throw error;

    res.json({
      success: true,
      message: 'Sync configuration updated',
    });
  } catch (error: any) {
    console.error('❌ [SHOPIFY SYNC] Error updating config:', error);
    res.status(500).json({
      error: error.message,
    });
  }
});

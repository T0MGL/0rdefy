// Shopify Import Service
// Handles background import operations with pagination and progress tracking
// Supports products, customers, and orders synchronization

import { SupabaseClient } from '@supabase/supabase-js';
import { ShopifyClientService } from './shopify-client.service';
import {
  ShopifyIntegration,
  ShopifyImportJob,
  ShopifyProduct,
  ShopifyCustomer,
  ShopifyOrder
} from '../types/shopify';

export class ShopifyImportService {
  private supabaseAdmin: SupabaseClient;
  private shopifyClient: ShopifyClientService;
  private integration: ShopifyIntegration;

  constructor(supabase: SupabaseClient, integration: ShopifyIntegration) {
    this.supabaseAdmin = supabase;
    this.integration = integration;
    this.shopifyClient = new ShopifyClientService(integration);
  }

  // Start background import job for selected data types
  async startImport(params: {
    job_type: 'initial' | 'manual' | 'scheduled';
    import_types: Array<'products' | 'customers' | 'orders'>;
    force_full_sync?: boolean;
  }): Promise<string[]> {
    console.log('🔄 [SHOPIFY-IMPORT] Starting import:', {
      job_type: params.job_type,
      import_types: params.import_types,
      force_full_sync: params.force_full_sync,
      integration_id: this.integration.id,
      shop_domain: this.integration.shop_domain
    });

    const jobIds: string[] = [];

    for (const import_type of params.import_types) {
      const jobId = await this.createImportJob({
        job_type: params.job_type,
        import_type,
        force_full_sync: params.force_full_sync || false
      });
      jobIds.push(jobId);

      console.log(`✅ [SHOPIFY-IMPORT] Created job ${jobId} for ${import_type}`);

      // Start background processing
      this.processImportJob(jobId).catch(error => {
        console.error(`❌ [SHOPIFY-IMPORT] Error processing job ${jobId}:`, error);
        this.markJobFailed(jobId, error.message);
      });
    }

    console.log(`🎯 [SHOPIFY-IMPORT] Started ${jobIds.length} import jobs:`, jobIds);
    return jobIds;
  }

  // Create import job record
  private async createImportJob(params: {
    job_type: string;
    import_type: string;
    force_full_sync: boolean;
  }): Promise<string> {
    const { data, error } = await this.supabaseAdmin
      .from('shopify_import_jobs')
      .insert({
        integration_id: this.integration.id,
        store_id: this.integration.store_id,
        job_type: params.job_type,
        import_type: params.import_type,
        status: 'pending',
        page_size: 50,
        has_more: true
      })
      .select('id')
      .single();

    if (error) throw new Error(`Error al crear trabajo de importación: ${error.message}`);
    return data.id;
  }

  // Process import job with pagination
  private async processImportJob(jobId: string): Promise<void> {
    console.log(`🚀 [SHOPIFY-IMPORT] Processing job ${jobId}`);

    // Update job to running status
    await this.updateJobStatus(jobId, 'running', { started_at: new Date().toISOString() });

    try {
      const job = await this.getJob(jobId);
      console.log(`📋 [SHOPIFY-IMPORT] Job details:`, {
        id: job.id,
        type: job.import_type,
        status: job.status,
        page_size: job.page_size
      });

      switch (job.import_type) {
        case 'products':
          console.log(`📦 [SHOPIFY-IMPORT] Starting products import for job ${jobId}`);
          await this.importProducts(job);
          break;
        case 'customers':
          console.log(`👥 [SHOPIFY-IMPORT] Starting customers import for job ${jobId}`);
          await this.importCustomers(job);
          break;
        case 'orders':
          console.log(`🛒 [SHOPIFY-IMPORT] Starting orders import for job ${jobId}`);
          await this.importOrders(job);
          break;
        default:
          throw new Error(`Unknown import type: ${job.import_type}`);
      }

      console.log(`✅ [SHOPIFY-IMPORT] Job ${jobId} completed successfully`);

      // Mark job as completed
      await this.updateJobStatus(jobId, 'completed', {
        completed_at: new Date().toISOString(),
        has_more: false
      });

      // Update integration last sync time
      await this.supabaseAdmin
        .from('shopify_integrations')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', this.integration.id);

    } catch (error: any) {
      console.error(`❌ [SHOPIFY-IMPORT] Import job ${jobId} failed:`, error);
      console.error(`❌ [SHOPIFY-IMPORT] Error details:`, {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      await this.markJobFailed(jobId, error.message);
    }
  }

  // Import products with pagination
  private async importProducts(job: ShopifyImportJob): Promise<void> {
    console.log(`📦 [SHOPIFY-IMPORT] Starting product import with pagination (page_size: ${job.page_size})`);

    let hasMore = true;
    let pageInfo: string | undefined;
    let processedCount = 0;
    const importedProducts: Array<{ id: string; stock: number; name: string; cost: number }> = [];

    // Get total count estimate
    let totalEstimate = 0;
    try {
      console.log(`📊 [SHOPIFY-IMPORT] Getting product count estimate...`);
      const { products: sampleProducts } = await this.shopifyClient.getProducts({ limit: 1 });
      if (sampleProducts.length > 0) {
        totalEstimate = sampleProducts[0].id;
        console.log(`📊 [SHOPIFY-IMPORT] Estimated total products: ~${totalEstimate}`);
      }
    } catch (error) {
      console.warn('⚠️  [SHOPIFY-IMPORT] Could not estimate product count:', error);
    }

    if (totalEstimate > 0) {
      await this.updateJobProgress(job.id, { total_items: totalEstimate });
    }

    console.log(`🔄 [SHOPIFY-IMPORT] Starting product pagination loop...`);
    let pageCount = 0;

    while (hasMore) {
      try {
        pageCount++;
        console.log(`📄 [SHOPIFY-IMPORT] Fetching page ${pageCount} (cursor: ${pageInfo || 'initial'})...`);

        const { products, pagination } = await this.shopifyClient.getProducts({
          limit: job.page_size,
          page_info: pageInfo
        });

        console.log(`📦 [SHOPIFY-IMPORT] Received ${products.length} products from Shopify API`);

        if (products.length === 0) {
          console.log(`✅ [SHOPIFY-IMPORT] No more products to fetch. Ending pagination.`);
          hasMore = false;
          break;
        }

        // Process batch of products
        for (const shopifyProduct of products) {
          try {
            const productData = await this.upsertProduct(shopifyProduct);
            if (productData) {
              importedProducts.push(productData);
            }
            processedCount++;

            await this.updateJobProgress(job.id, {
              processed_items: processedCount,
              success_items: processedCount
            });
          } catch (error: any) {
            console.error(`Error al importar producto ${shopifyProduct.id}:`, error);
            await this.updateJobProgress(job.id, {
              processed_items: processedCount,
              failed_items: (job.failed_items || 0) + 1
            });
          }
        }

        // Update pagination state
        hasMore = pagination.has_next;
        pageInfo = pagination.next_cursor;

        console.log(`📊 [SHOPIFY-IMPORT] Page ${pageCount} complete. Processed: ${processedCount} total. Has more: ${hasMore}`);

        await this.updateJobProgress(job.id, {
          last_cursor: pageInfo,
          has_more: hasMore
        });

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error: any) {
        console.error('Error fetching products page:', error);

        // Retry logic
        if (job.retry_count < job.max_retries) {
          await this.supabaseAdmin
            .from('shopify_import_jobs')
            .update({ retry_count: job.retry_count + 1 })
            .eq('id', job.id);

          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        } else {
          throw error;
        }
      }
    }

    // Create automatic inbound shipment if products were imported
    if (importedProducts.length > 0) {
      try {
        // Check for duplicate import today to prevent multiple shipments
        const { data: duplicateCheck, error: rpcError } = await this.supabaseAdmin
          .rpc('check_shopify_import_duplicate', {
            p_store_id: this.integration.store_id,
            p_tracking_prefix: 'SHOPIFY-IMPORT-'
          });

        // If RPC function doesn't exist, proceed with shipment creation (graceful degradation)
        if (rpcError) {
          console.warn(`⚠️  [SHOPIFY-IMPORT] Duplicate check RPC not available, proceeding with shipment creation: ${rpcError.message}`);
          console.log(`📦 [SHOPIFY-IMPORT] Creating automatic inbound shipment for ${importedProducts.length} products...`);
          await this.createAutomaticInboundShipment(importedProducts);
        } else if (duplicateCheck && duplicateCheck.length > 0 && duplicateCheck[0].has_duplicate) {
          console.warn(
            `⚠️  [SHOPIFY-IMPORT] Skipping automatic inbound shipment - already created today: ` +
            `${duplicateCheck[0].existing_reference} at ${duplicateCheck[0].created_at}`
          );
        } else {
          console.log(`📦 [SHOPIFY-IMPORT] Creating automatic inbound shipment for ${importedProducts.length} products...`);
          await this.createAutomaticInboundShipment(importedProducts);
        }
      } catch (error: any) {
        console.error('❌ [SHOPIFY-IMPORT] Error al crear envío de entrada automático:', error);
        // Don't fail the import job if shipment creation fails
      }
    }
  }

  // Import customers with pagination
  private async importCustomers(job: ShopifyImportJob): Promise<void> {
    console.log(`👥 [SHOPIFY-IMPORT] Starting customer import with pagination (page_size: ${job.page_size})`);

    let hasMore = true;
    let pageInfo: string | undefined;
    let processedCount = 0;
    let pageCount = 0;

    while (hasMore) {
      try {
        pageCount++;
        console.log(`📄 [SHOPIFY-IMPORT] Fetching customer page ${pageCount} (cursor: ${pageInfo || 'initial'})...`);

        const { customers, pagination } = await this.shopifyClient.getCustomers({
          limit: job.page_size,
          page_info: pageInfo
        });

        console.log(`👥 [SHOPIFY-IMPORT] Received ${customers.length} customers from Shopify API`);

        if (customers.length === 0) {
          console.log(`✅ [SHOPIFY-IMPORT] No more customers to fetch. Ending pagination.`);
          hasMore = false;
          break;
        }

        for (const shopifyCustomer of customers) {
          try {
            await this.upsertCustomer(shopifyCustomer);
            processedCount++;

            await this.updateJobProgress(job.id, {
              processed_items: processedCount,
              success_items: processedCount
            });
          } catch (error: any) {
            console.error(`Error al importar cliente ${shopifyCustomer.id}:`, error);
            await this.updateJobProgress(job.id, {
              processed_items: processedCount,
              failed_items: (job.failed_items || 0) + 1
            });
          }
        }

        hasMore = pagination.has_next;
        pageInfo = pagination.next_cursor;

        console.log(`📊 [SHOPIFY-IMPORT] Customer page ${pageCount} complete. Processed: ${processedCount} total. Has more: ${hasMore}`);

        await this.updateJobProgress(job.id, {
          last_cursor: pageInfo,
          has_more: hasMore
        });

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error: any) {
        console.error('❌ [SHOPIFY-IMPORT] Error fetching customers page:', error);

        if (job.retry_count < job.max_retries) {
          await this.supabaseAdmin
            .from('shopify_import_jobs')
            .update({ retry_count: job.retry_count + 1 })
            .eq('id', job.id);

          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        } else {
          throw error;
        }
      }
    }
  }

  // Import orders with pagination
  private async importOrders(job: ShopifyImportJob): Promise<void> {
    let hasMore = true;
    let pageInfo: string | undefined;
    let processedCount = 0;

    // For historical orders, get count first
    let totalCount = 0;
    if (this.integration.import_historical_orders) {
      try {
        totalCount = await this.shopifyClient.getOrderCount({ status: 'any' });
        await this.updateJobProgress(job.id, { total_items: totalCount });
      } catch (error) {
        console.warn('Could not get order count');
      }
    }

    while (hasMore) {
      try {
        const { orders, pagination } = await this.shopifyClient.getOrders({
          limit: job.page_size,
          page_info: pageInfo,
          status: 'any'
        });

        if (orders.length === 0) {
          hasMore = false;
          break;
        }

        for (const shopifyOrder of orders) {
          try {
            await this.upsertOrder(shopifyOrder);
            processedCount++;

            await this.updateJobProgress(job.id, {
              processed_items: processedCount,
              success_items: processedCount
            });
          } catch (error: any) {
            console.error(`Error al importar pedido ${shopifyOrder.id}:`, error);
            await this.updateJobProgress(job.id, {
              processed_items: processedCount,
              failed_items: (job.failed_items || 0) + 1
            });
          }
        }

        hasMore = pagination.has_next;
        pageInfo = pagination.next_cursor;

        await this.updateJobProgress(job.id, {
          last_cursor: pageInfo,
          has_more: hasMore
        });

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error: any) {
        console.error('Error fetching orders page:', error);

        if (job.retry_count < job.max_retries) {
          await this.supabaseAdmin
            .from('shopify_import_jobs')
            .update({ retry_count: job.retry_count + 1 })
            .eq('id', job.id);

          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        } else {
          throw error;
        }
      }
    }
  }

  // Upsert product to database
  private async upsertProduct(shopifyProduct: ShopifyProduct): Promise<{ id: string; stock: number; name: string; cost: number } | null> {
    const variant = shopifyProduct.variants[0];
    if (!variant) return null;

    const stock = variant.inventory_quantity || 0;

    const productData = {
      store_id: this.integration.store_id,
      shopify_product_id: shopifyProduct.id.toString(),
      shopify_variant_id: variant.id.toString(),
      name: shopifyProduct.title,
      description: shopifyProduct.body_html || '',
      sku: variant.sku || '',
      price: parseFloat(variant.price),
      cost: 0, // Default cost, user can update later
      stock: stock,
      status: shopifyProduct.status === 'active' ? 'active' : 'inactive',
      category: shopifyProduct.product_type || '',
      image_url: shopifyProduct.image?.src || '',
      shopify_data: shopifyProduct,
      last_synced_at: new Date().toISOString(),
      sync_status: 'synced'
    };

    const { data, error } = await this.supabaseAdmin
      .from('products')
      .upsert(productData, {
        onConflict: 'store_id,shopify_product_id',
        ignoreDuplicates: false
      })
      .select('id, stock, name, cost')
      .single();

    if (error) {
      throw new Error(`Error al insertar/actualizar producto: ${error.message}`);
    }

    // Return product data for shipment creation (only if stock > 0)
    if (data && stock > 0) {
      return {
        id: data.id,
        stock: stock,
        name: shopifyProduct.title,
        cost: 0 // Will use product cost from DB
      };
    }

    return null;
  }

  // Upsert customer to database
  private async upsertCustomer(shopifyCustomer: ShopifyCustomer): Promise<void> {
    const customerData = {
      store_id: this.integration.store_id,
      shopify_customer_id: shopifyCustomer.id.toString(),
      name: `${shopifyCustomer.first_name} ${shopifyCustomer.last_name}`.trim(),
      email: shopifyCustomer.email,
      phone: shopifyCustomer.phone || '',
      address: shopifyCustomer.default_address?.address1 || '',
      city: shopifyCustomer.default_address?.city || '',
      state: shopifyCustomer.default_address?.province || '',
      postal_code: shopifyCustomer.default_address?.zip || '',
      country: shopifyCustomer.default_address?.country || '',
      notes: shopifyCustomer.note || '',
      tags: shopifyCustomer.tags,
      total_orders: shopifyCustomer.orders_count,
      total_spent: parseFloat(shopifyCustomer.total_spent),
      shopify_data: shopifyCustomer,
      last_synced_at: new Date().toISOString(),
      sync_status: 'synced'
    };

    const { error } = await this.supabaseAdmin
      .from('customers')
      .upsert(customerData, {
        onConflict: 'store_id,shopify_customer_id',
        ignoreDuplicates: false
      });

    if (error) {
      throw new Error(`Error al insertar/actualizar cliente: ${error.message}`);
    }
  }

  // Upsert order to database
  private async upsertOrder(shopifyOrder: ShopifyOrder): Promise<void> {
    // Extract shipping address fields
    const shippingAddr = shopifyOrder.shipping_address;
    const billingAddr = shopifyOrder.billing_address;

    // Build full address string from shipping address
    let fullAddress = '';
    if (shippingAddr) {
      const parts = [
        shippingAddr.address1,
        shippingAddr.address2
      ].filter(Boolean);
      fullAddress = parts.join(', ');
    }

    // Extract phone numbers
    const primaryPhone = shopifyOrder.phone || shopifyOrder.customer?.phone || shippingAddr?.phone || '';
    const backupPhone = billingAddr?.phone && billingAddr.phone !== primaryPhone ? billingAddr.phone : '';

    const orderData = {
      store_id: this.integration.store_id,
      shopify_order_id: shopifyOrder.id.toString(),
      shopify_order_number: shopifyOrder.order_number.toString(),
      shopify_data: shopifyOrder,
      shopify_raw_json: shopifyOrder,
      last_synced_at: new Date().toISOString(),
      sync_status: 'synced',

      // Customer info
      customer_email: shopifyOrder.email || shopifyOrder.customer?.email || '',
      customer_phone: primaryPhone,
      customer_first_name: shopifyOrder.customer?.first_name || billingAddr?.first_name || '',
      customer_last_name: shopifyOrder.customer?.last_name || billingAddr?.last_name || '',

      // Address info (JSONB fields)
      billing_address: billingAddr,
      shipping_address: shippingAddr,

      // Address info (denormalized fields for easier querying)
      customer_address: fullAddress,
      neighborhood: shippingAddr?.neighborhood || shippingAddr?.address2 || '',
      phone_backup: backupPhone,
      delivery_notes: shopifyOrder.note || '',

      // Line items (keep JSONB for backwards compatibility)
      line_items: shopifyOrder.line_items,

      // Pricing
      total_price: parseFloat(shopifyOrder.total_price),
      subtotal_price: parseFloat(shopifyOrder.subtotal_price || shopifyOrder.total_price),
      total_tax: parseFloat(shopifyOrder.total_tax || '0'),
      total_discounts: parseFloat(shopifyOrder.total_discounts || '0'),
      total_shipping: parseFloat(shopifyOrder.total_shipping || '0'),
      currency: shopifyOrder.currency || 'USD',

      // Status
      financial_status: shopifyOrder.financial_status || 'pending',
      fulfillment_status: shopifyOrder.fulfillment_status,

      // Metadata
      tags: shopifyOrder.tags,
      note: shopifyOrder.note,
      created_at: shopifyOrder.created_at,
      updated_at: shopifyOrder.updated_at || shopifyOrder.created_at,
      processed_at: shopifyOrder.processed_at || shopifyOrder.created_at
    };

    const { data: upsertedOrder, error } = await this.supabaseAdmin
      .from('orders')
      .upsert(orderData, {
        onConflict: 'store_id,shopify_order_id',
        ignoreDuplicates: false
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Error al insertar/actualizar pedido: ${error.message}`);
    }

    // Create normalized line items with product mapping
    if (upsertedOrder && shopifyOrder.line_items) {
      await this.createLineItemsForOrder(
        upsertedOrder.id,
        this.integration.store_id,
        shopifyOrder.line_items
      );
    }
  }

  // Crear line items normalizados para un pedido
  private async createLineItemsForOrder(
    orderId: string,
    storeId: string,
    lineItems: any[]
  ): Promise<void> {
    try {
      // Delete existing line items for this order (in case of update)
      await this.supabaseAdmin
        .from('order_line_items')
        .delete()
        .eq('order_id', orderId);

      // Process each line item
      for (const item of lineItems) {
        // Extract Shopify IDs
        const shopifyProductId = item.product_id?.toString() || null;
        const shopifyVariantId = item.variant_id?.toString() || null;
        const shopifyLineItemId = item.id?.toString() || null;
        const sku = item.sku || '';

        // Try to find matching local product
        let productId: string | null = null;

        // First try by variant ID (most specific)
        if (shopifyVariantId) {
          const { data: productByVariant } = await this.supabaseAdmin
            .from('products')
            .select('id')
            .eq('store_id', storeId)
            .eq('shopify_variant_id', shopifyVariantId)
            .maybeSingle();

          if (productByVariant) {
            productId = productByVariant.id;
          }
        }

        // If not found, try by product ID
        if (!productId && shopifyProductId) {
          const { data: productByProductId } = await this.supabaseAdmin
            .from('products')
            .select('id')
            .eq('store_id', storeId)
            .eq('shopify_product_id', shopifyProductId)
            .maybeSingle();

          if (productByProductId) {
            productId = productByProductId.id;
          }
        }

        // If still not found, try by SKU
        if (!productId && sku) {
          const { data: productBySku } = await this.supabaseAdmin
            .from('products')
            .select('id')
            .eq('store_id', storeId)
            .eq('sku', sku)
            .maybeSingle();

          if (productBySku) {
            productId = productBySku.id;
          }
        }

        // Log if product not found
        if (!productId && shopifyProductId) {
          console.warn(
            `⚠️  [IMPORT] Product not found for line item: ` +
            `Shopify Product ID ${shopifyProductId}, Variant ID ${shopifyVariantId}, SKU "${sku}". ` +
            `Line item will be created without product mapping.`
          );
        }

        // Calculate prices
        const quantity = parseInt(item.quantity) || 1;
        const unitPrice = parseFloat(item.price) || 0;
        const totalPrice = quantity * unitPrice;
        const discountAmount = parseFloat(item.total_discount) || 0;
        const taxAmount = item.tax_lines && item.tax_lines.length > 0
          ? parseFloat(item.tax_lines[0].price) || 0
          : 0;

        // Insert line item
        const { error: insertError } = await this.supabaseAdmin
          .from('order_line_items')
          .insert({
            order_id: orderId,
            product_id: productId,
            shopify_product_id: shopifyProductId,
            shopify_variant_id: shopifyVariantId,
            shopify_line_item_id: shopifyLineItemId,
            product_name: item.name || item.title || 'Unknown Product',
            variant_title: item.variant_title || null,
            sku: sku,
            quantity: quantity,
            unit_price: unitPrice,
            total_price: totalPrice,
            discount_amount: discountAmount,
            tax_amount: taxAmount,
            properties: item.properties || null,
            shopify_data: item
          });

        if (insertError) {
          console.error(`Error inserting line item:`, insertError);
          throw new Error(`Error al insertar línea de pedido: ${insertError.message}`);
        }
      }

      console.log(`✅ [IMPORT] Created ${lineItems.length} normalized line items for order ${orderId}`);

    } catch (error: any) {
      console.error('[IMPORT] Error creating line items for order:', error);
      throw error;
    }
  }

  // Map Shopify order status to internal status
  private mapOrderStatus(financialStatus: string, fulfillmentStatus: string | null): string {
    if (fulfillmentStatus === 'fulfilled') return 'delivered';
    if (financialStatus === 'refunded') return 'cancelled';
    if (financialStatus === 'paid' && !fulfillmentStatus) return 'confirmed';
    if (financialStatus === 'paid' && fulfillmentStatus === 'partial') return 'in_transit';
    return 'pending';
  }

  // Helper methods for job management

  private async getJob(jobId: string): Promise<ShopifyImportJob> {
    const { data, error } = await this.supabaseAdmin
      .from('shopify_import_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error) throw new Error(`Error al obtener trabajo: ${error.message}`);
    return data;
  }

  private async updateJobStatus(jobId: string, status: string, additional: any = {}): Promise<void> {
    const { error } = await this.supabaseAdmin
      .from('shopify_import_jobs')
      .update({ status, ...additional })
      .eq('id', jobId);

    if (error) throw new Error(`Error al actualizar estado del trabajo: ${error.message}`);
  }

  private async updateJobProgress(jobId: string, progress: Partial<ShopifyImportJob>): Promise<void> {
    const { error } = await this.supabaseAdmin
      .from('shopify_import_jobs')
      .update(progress)
      .eq('id', jobId);

    if (error) console.error('Error al actualizar progreso del trabajo:', error);
  }

  private async markJobFailed(jobId: string, errorMessage: string): Promise<void> {
    await this.updateJobStatus(jobId, 'failed', {
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    });
  }

  // Create automatic inbound shipment for imported products
  private async createAutomaticInboundShipment(
    products: Array<{ id: string; stock: number; name: string; cost: number }>
  ): Promise<void> {
    try {
      // Generate reference using the database function
      const { data: referenceData, error: refError } = await this.supabaseAdmin
        .rpc('generate_inbound_reference', { p_store_id: this.integration.store_id });

      if (refError) {
        console.error('❌ Error generating inbound reference:', refError);
        throw refError;
      }

      const reference = referenceData as string;

      console.log(`📦 [SHOPIFY-IMPORT] Creating inbound shipment with reference: ${reference}`);

      // Create the inbound shipment
      const { data: shipment, error: shipmentError } = await this.supabaseAdmin
        .from('inbound_shipments')
        .insert({
          store_id: this.integration.store_id,
          internal_reference: reference,
          supplier_id: null, // Shopify import (no supplier)
          carrier_id: null,
          tracking_code: `SHOPIFY-IMPORT-${new Date().toISOString().split('T')[0]}`,
          estimated_arrival_date: new Date().toISOString().split('T')[0],
          received_date: new Date().toISOString(),
          status: 'received', // Already received in Shopify
          shipping_cost: 0,
          total_cost: 0, // Will be calculated from items
          notes: `Recepción automática de inventario inicial desde Shopify. Importados ${products.length} productos con stock.`,
          created_by: this.integration.user_id || null,
          received_by: this.integration.user_id || null
        })
        .select('id')
        .single();

      if (shipmentError) {
        console.error('❌ Error creating inbound shipment:', shipmentError);
        throw shipmentError;
      }

      console.log(`✅ [SHOPIFY-IMPORT] Inbound shipment created: ${shipment.id}`);

      // Create shipment items
      const shipmentItems = products.map(product => ({
        shipment_id: shipment.id,
        product_id: product.id,
        qty_ordered: product.stock,
        qty_received: product.stock, // Already received
        qty_rejected: 0,
        unit_cost: product.cost || 0,
        discrepancy_notes: 'Inventario inicial importado desde Shopify'
      }));

      const { error: itemsError } = await this.supabaseAdmin
        .from('inbound_shipment_items')
        .insert(shipmentItems);

      if (itemsError) {
        console.error('❌ Error creating shipment items:', itemsError);
        throw itemsError;
      }

      console.log(`✅ [SHOPIFY-IMPORT] Created ${shipmentItems.length} shipment items`);

      // Create inventory movements for audit trail
      const inventoryMovements = products
        .filter(p => p.stock > 0)
        .map(product => ({
          store_id: this.integration.store_id,
          product_id: product.id,
          movement_type: 'inbound_receipt',
          quantity: product.stock,
          reference_type: 'inbound_shipment',
          reference_id: shipment.id,
          notes: 'Inventario inicial importado desde Shopify',
          created_by: this.integration.user_id || null
        }));

      if (inventoryMovements.length > 0) {
        const { error: movementsError } = await this.supabaseAdmin
          .from('inventory_movements')
          .insert(inventoryMovements);

        if (movementsError) {
          console.warn('⚠️ [SHOPIFY-IMPORT] Could not create inventory movements:', movementsError);
          // Don't fail the import if movements can't be created
        } else {
          console.log(`✅ [SHOPIFY-IMPORT] Created ${inventoryMovements.length} inventory movement records`);
        }
      }

      console.log(`📊 [SHOPIFY-IMPORT] Total stock imported: ${products.reduce((sum, p) => sum + p.stock, 0)} units`);

    } catch (error: any) {
      console.error('❌ [SHOPIFY-IMPORT] Error creating automatic inbound shipment:', error);
      throw error;
    }
  }

  // Get import status for UI monitoring
  async getImportStatus(integrationId: string): Promise<any> {
    const { data: jobs, error } = await this.supabaseAdmin
      .from('shopify_import_jobs')
      .select('*')
      .eq('integration_id', integrationId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw new Error(`Error al obtener estado de importación: ${error.message}`);

    const activeJobs = jobs.filter(j => ['pending', 'running'].includes(j.status));
    const overallStatus = activeJobs.length > 0 ? 'syncing' : 'idle';

    const totalProgress = jobs.length > 0
      ? jobs.reduce((sum, j) => {
          if (j.total_items > 0) {
            return sum + (j.processed_items / j.total_items) * 100;
          }
          return sum;
        }, 0) / jobs.length
      : 0;

    return {
      integration_id: integrationId,
      jobs,
      overall_status: overallStatus,
      total_progress: Math.round(totalProgress),
      last_sync_at: this.integration.last_sync_at
    };
  }
}

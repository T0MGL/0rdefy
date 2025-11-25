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

    if (error) throw new Error(`Failed to create import job: ${error.message}`);
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
            await this.upsertProduct(shopifyProduct);
            processedCount++;

            await this.updateJobProgress(job.id, {
              processed_items: processedCount,
              success_items: processedCount
            });
          } catch (error: any) {
            console.error(`Failed to import product ${shopifyProduct.id}:`, error);
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
            console.error(`Failed to import customer ${shopifyCustomer.id}:`, error);
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
            console.error(`Failed to import order ${shopifyOrder.id}:`, error);
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
  private async upsertProduct(shopifyProduct: ShopifyProduct): Promise<void> {
    const variant = shopifyProduct.variants[0];
    if (!variant) return;

    const productData = {
      store_id: this.integration.store_id,
      shopify_product_id: shopifyProduct.id.toString(),
      shopify_variant_id: variant.id.toString(),
      name: shopifyProduct.title,
      description: shopifyProduct.body_html || '',
      sku: variant.sku || '',
      price: parseFloat(variant.price),
      cost: 0,
      stock: variant.inventory_quantity || 0,
      status: shopifyProduct.status === 'active' ? 'active' : 'inactive',
      category: shopifyProduct.product_type || '',
      image_url: shopifyProduct.image?.src || '',
      shopify_data: shopifyProduct,
      last_synced_at: new Date().toISOString(),
      sync_status: 'synced'
    };

    const { error } = await this.supabaseAdmin
      .from('products')
      .upsert(productData, {
        onConflict: 'store_id,shopify_product_id',
        ignoreDuplicates: false
      });

    if (error) {
      throw new Error(`Failed to upsert product: ${error.message}`);
    }
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
      throw new Error(`Failed to upsert customer: ${error.message}`);
    }
  }

  // Upsert order to database
  private async upsertOrder(shopifyOrder: ShopifyOrder): Promise<void> {
    const orderData = {
      store_id: this.integration.store_id,
      shopify_order_id: shopifyOrder.id.toString(),
      shopify_order_number: shopifyOrder.order_number.toString(),
      customer: `${shopifyOrder.customer.first_name} ${shopifyOrder.customer.last_name}`.trim(),
      email: shopifyOrder.email,
      phone: shopifyOrder.phone || shopifyOrder.customer.phone || '',
      product: shopifyOrder.line_items.map(item => item.title).join(', '),
      quantity: shopifyOrder.line_items.reduce((sum, item) => sum + item.quantity, 0),
      total: parseFloat(shopifyOrder.total_price),
      status: this.mapOrderStatus(shopifyOrder.financial_status, shopifyOrder.fulfillment_status),
      date: shopifyOrder.created_at,
      shipping_address: shopifyOrder.shipping_address?.address1 || '',
      shipping_city: shopifyOrder.shipping_address?.city || '',
      shipping_state: shopifyOrder.shipping_address?.province || '',
      shipping_postal_code: shopifyOrder.shipping_address?.zip || '',
      shopify_data: shopifyOrder,
      last_synced_at: new Date().toISOString(),
      sync_status: 'synced'
    };

    const { error } = await this.supabaseAdmin
      .from('orders')
      .upsert(orderData, {
        onConflict: 'store_id,shopify_order_id',
        ignoreDuplicates: false
      });

    if (error) {
      throw new Error(`Failed to upsert order: ${error.message}`);
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

    if (error) throw new Error(`Failed to get job: ${error.message}`);
    return data;
  }

  private async updateJobStatus(jobId: string, status: string, additional: any = {}): Promise<void> {
    const { error } = await this.supabaseAdmin
      .from('shopify_import_jobs')
      .update({ status, ...additional })
      .eq('id', jobId);

    if (error) throw new Error(`Failed to update job status: ${error.message}`);
  }

  private async updateJobProgress(jobId: string, progress: Partial<ShopifyImportJob>): Promise<void> {
    const { error } = await this.supabaseAdmin
      .from('shopify_import_jobs')
      .update(progress)
      .eq('id', jobId);

    if (error) console.error('Failed to update job progress:', error);
  }

  private async markJobFailed(jobId: string, errorMessage: string): Promise<void> {
    await this.updateJobStatus(jobId, 'failed', {
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    });
  }

  // Get import status for UI monitoring
  async getImportStatus(integrationId: string): Promise<any> {
    const { data: jobs, error } = await this.supabaseAdmin
      .from('shopify_import_jobs')
      .select('*')
      .eq('integration_id', integrationId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw new Error(`Failed to get import status: ${error.message}`);

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

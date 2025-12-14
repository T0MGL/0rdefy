// ================================================================
// Shopify Inventory Sync Service
// ================================================================
// Bidirectional inventory synchronization between Ordefy and Shopify
// - Dashboard → Shopify: Update Shopify inventory when local stock changes
// - Shopify → Dashboard: Handled by webhooks (already implemented)
// ================================================================

import { SupabaseClient } from '@supabase/supabase-js';
import { ShopifyClientService } from './shopify-client.service';

export class ShopifyInventorySyncService {
  private supabaseAdmin: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabaseAdmin = supabase;
  }

  /**
   * Sync inventory from Dashboard to Shopify
   * Called when stock is updated locally
   */
  async syncInventoryToShopify(params: {
    storeId: string;
    productId: string;
    newStock: number;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`📦 [INVENTORY-SYNC] Starting sync for product ${params.productId}, new stock: ${params.newStock}`);

      // 1. Get product details
      const { data: product, error: productError } = await this.supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', params.productId)
        .eq('store_id', params.storeId)
        .single();

      if (productError || !product) {
        throw new Error(`Product not found: ${productError?.message}`);
      }

      // 2. Check if product is linked to Shopify
      if (!product.shopify_variant_id && !product.shopify_product_id) {
        console.log(`⚠️  [INVENTORY-SYNC] Product ${params.productId} is not linked to Shopify, skipping sync`);
        return {
          success: true,
          error: 'Product not linked to Shopify'
        };
      }

      // 3. Get Shopify integration for this store
      const { data: integration, error: integrationError } = await this.supabaseAdmin
        .from('shopify_integrations')
        .select('*')
        .eq('store_id', params.storeId)
        .eq('status', 'active')
        .single();

      if (integrationError || !integration) {
        console.log(`⚠️  [INVENTORY-SYNC] No active Shopify integration found for store ${params.storeId}`);
        return {
          success: false,
          error: 'No active Shopify integration'
        };
      }

      // 4. Update inventory in Shopify using GraphQL client
      const shopifyClient = new ShopifyClientService(integration);
      await shopifyClient.updateInventory(
        product.shopify_variant_id || product.shopify_product_id!,
        params.newStock
      );

      console.log(`✅ [INVENTORY-SYNC] Successfully synced inventory to Shopify for "${product.name}"`);

      // 5. Update sync status in database
      await this.supabaseAdmin
        .from('products')
        .update({
          last_synced_at: new Date().toISOString(),
          sync_status: 'synced'
        })
        .eq('id', params.productId);

      console.log(`✅ [INVENTORY-SYNC] Successfully synced inventory to Shopify for product ${params.productId}`);

      return { success: true };

    } catch (error: any) {
      console.error(`❌ [INVENTORY-SYNC] Error syncing inventory:`, error);

      // Mark product as having sync error
      await this.supabaseAdmin
        .from('products')
        .update({
          sync_status: 'error',
          last_synced_at: new Date().toISOString()
        })
        .eq('id', params.productId)
        .catch(err => console.error('Error updating sync status:', err));

      return {
        success: false,
        error: error.message || 'Failed to sync inventory'
      };
    }
  }


  /**
   * Sync inventory for multiple products (batch operation)
   */
  async batchSyncInventoryToShopify(params: {
    storeId: string;
    products: Array<{ productId: string; newStock: number }>;
  }): Promise<{
    success: number;
    failed: number;
    errors: Array<{ productId: string; error: string }>;
  }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ productId: string; error: string }>
    };

    console.log(`📦 [INVENTORY-SYNC] Starting batch sync for ${params.products.length} products`);

    for (const product of params.products) {
      const result = await this.syncInventoryToShopify({
        storeId: params.storeId,
        productId: product.productId,
        newStock: product.newStock
      });

      if (result.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({
          productId: product.productId,
          error: result.error || 'Unknown error'
        });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`✅ [INVENTORY-SYNC] Batch sync complete: ${results.success} success, ${results.failed} failed`);

    return results;
  }
}

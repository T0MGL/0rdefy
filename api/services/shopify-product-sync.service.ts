// Shopify Product Sync Service
// Maneja la sincronizacion de productos desde el dashboard hacia Shopify
// Solo actualiza y elimina productos en Shopify cuando se modifican localmente

import { SupabaseClient } from '@supabase/supabase-js';
import { ShopifyClientService } from './shopify-client.service';
import { ShopifyIntegration } from '../types/shopify';

export class ShopifyProductSyncService {
  private supabaseAdmin: SupabaseClient;
  private shopifyClient: ShopifyClientService;
  private integration: ShopifyIntegration;

  constructor(supabase: SupabaseClient, integration: ShopifyIntegration) {
    this.supabaseAdmin = supabase;
    this.integration = integration;
    this.shopifyClient = new ShopifyClientService(integration);
  }

  // Actualizar producto en Shopify cuando se modifica en el dashboard
  async updateProductInShopify(productId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Obtener producto de la base de datos
      const { data: product, error: fetchError } = await this.supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', productId)
        .eq('store_id', this.integration.store_id)
        .single();

      if (fetchError || !product) {
        return { success: false, error: 'Producto no encontrado' };
      }

      // Verificar si el producto tiene shopify_product_id
      if (!product.shopify_product_id) {
        return { success: false, error: 'Producto no está vinculado a Shopify' };
      }

      // Preparar datos para actualizar en Shopify
      const shopifyProductData: any = {
        title: product.name,
        body_html: product.description,
        vendor: product.vendor || '',
        product_type: product.category || '',
        tags: product.tags || '',
        status: product.status === 'active' ? 'active' : 'draft'
      };

      // Actualizar variante principal con precio y stock
      const variantData: any = {
        price: product.price.toString(),
        sku: product.sku,
        inventory_quantity: product.stock
      };

      // Actualizar producto en Shopify
      await this.shopifyClient.updateProduct(
        product.shopify_product_id,
        shopifyProductData
      );

      // Actualizar inventario si hay variant_id
      if (product.shopify_variant_id) {
        const shopifyProduct = await this.shopifyClient.getProduct(product.shopify_product_id);
        const variant = shopifyProduct.variants.find(v => v.id.toString() === product.shopify_variant_id);

        if (variant && variant.inventory_item_id) {
          await this.shopifyClient.updateInventory(
            variant.inventory_item_id.toString(),
            product.stock
          );
        }
      }

      // Actualizar estado de sincronización en la base de datos
      await this.supabaseAdmin
        .from('products')
        .update({
          last_synced_at: new Date().toISOString(),
          sync_status: 'synced'
        })
        .eq('id', productId);

      return { success: true };

    } catch (error: any) {
      console.error('Error actualizando producto en Shopify:', error);

      // Marcar producto como error de sincronización
      await this.supabaseAdmin
        .from('products')
        .update({ sync_status: 'error' })
        .eq('id', productId);

      return {
        success: false,
        error: error.message || 'Error al actualizar en Shopify'
      };
    }
  }

  // Eliminar producto de Shopify cuando se elimina del dashboard
  async deleteProductFromShopify(productId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Obtener producto de la base de datos
      const { data: product, error: fetchError } = await this.supabaseAdmin
        .from('products')
        .select('shopify_product_id')
        .eq('id', productId)
        .eq('store_id', this.integration.store_id)
        .single();

      if (fetchError || !product) {
        return { success: false, error: 'Producto no encontrado' };
      }

      // Verificar si el producto tiene shopify_product_id
      if (!product.shopify_product_id) {
        // Si no tiene ID de Shopify, solo eliminarlo localmente
        await this.supabaseAdmin
          .from('products')
          .delete()
          .eq('id', productId);

        return { success: true };
      }

      // Eliminar producto de Shopify
      await this.shopifyClient.deleteProduct(product.shopify_product_id);

      // Eliminar producto de la base de datos
      await this.supabaseAdmin
        .from('products')
        .delete()
        .eq('id', productId);

      return { success: true };

    } catch (error: any) {
      console.error('Error eliminando producto de Shopify:', error);

      return {
        success: false,
        error: error.message || 'Error al eliminar de Shopify'
      };
    }
  }

  // Actualizar múltiples productos en batch
  async batchUpdateProducts(productIds: string[]): Promise<{
    success: number;
    failed: number;
    errors: Array<{ product_id: string; error: string }>;
  }> {
    let success = 0;
    let failed = 0;
    const errors: Array<{ product_id: string; error: string }> = [];

    for (const productId of productIds) {
      const result = await this.updateProductInShopify(productId);

      if (result.success) {
        success++;
      } else {
        failed++;
        errors.push({
          product_id: productId,
          error: result.error || 'Error desconocido'
        });
      }

      // Pequeña pausa para no sobrecargar la API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return { success, failed, errors };
  }

  // Marcar producto como pendiente de sincronización
  async markProductForSync(productId: string): Promise<void> {
    await this.supabaseAdmin
      .from('products')
      .update({ sync_status: 'pending' })
      .eq('id', productId);
  }

  // Obtener productos pendientes de sincronización
  async getPendingSyncProducts(): Promise<any[]> {
    const { data, error } = await this.supabaseAdmin
      .from('products')
      .select('*')
      .eq('store_id', this.integration.store_id)
      .eq('sync_status', 'pending')
      .not('shopify_product_id', 'is', null);

    if (error) {
      console.error('Error obteniendo productos pendientes:', error);
      return [];
    }

    return data || [];
  }

  // Procesar productos pendientes de sincronización
  async processPendingSync(): Promise<void> {
    const pendingProducts = await this.getPendingSyncProducts();

    console.log(`Procesando ${pendingProducts.length} productos pendientes de sincronización`);

    for (const product of pendingProducts) {
      await this.updateProductInShopify(product.id);

      // Pausa entre productos
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Publicar producto local a Shopify (crear nuevo producto en Shopify)
  async publishProductToShopify(productId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Obtener producto de la base de datos
      const { data: product, error: fetchError } = await this.supabaseAdmin
        .from('products')
        .select('*')
        .eq('id', productId)
        .eq('store_id', this.integration.store_id)
        .single();

      if (fetchError || !product) {
        return { success: false, error: 'Producto no encontrado' };
      }

      // Verificar si el producto ya está vinculado a Shopify
      if (product.shopify_product_id) {
        return { success: false, error: 'El producto ya está publicado en Shopify' };
      }

      // Preparar datos para crear en Shopify
      const shopifyProductData: any = {
        title: product.name,
        body_html: product.description || '',
        vendor: '',
        product_type: product.category || '',
        status: product.is_active ? 'active' : 'draft',
        variants: [
          {
            price: product.price.toString(),
            sku: product.sku || '',
            inventory_quantity: product.stock || 0
          }
        ]
      };

      // Agregar imagen si existe
      if (product.image_url && product.image_url !== 'https://via.placeholder.com/400x300?text=Product') {
        shopifyProductData.images = [{ src: product.image_url }];
      }

      // Crear producto en Shopify
      const shopifyProduct = await this.shopifyClient.createProduct(shopifyProductData);

      // Obtener el ID de la variante principal
      const mainVariant = shopifyProduct.variants?.[0];
      if (!mainVariant) {
        return { success: false, error: 'No se pudo obtener la variante del producto creado' };
      }

      // Actualizar producto local con IDs de Shopify
      await this.supabaseAdmin
        .from('products')
        .update({
          shopify_product_id: shopifyProduct.id.toString(),
          shopify_variant_id: mainVariant.id.toString(),
          last_synced_at: new Date().toISOString(),
          sync_status: 'synced'
        })
        .eq('id', productId);

      console.log(`✅ Producto ${productId} publicado exitosamente en Shopify (ID: ${shopifyProduct.id})`);

      return { success: true };

    } catch (error: any) {
      console.error('Error publicando producto a Shopify:', error);

      // Marcar producto como error de sincronización
      await this.supabaseAdmin
        .from('products')
        .update({ sync_status: 'error' })
        .eq('id', productId);

      return {
        success: false,
        error: error.message || 'Error al publicar en Shopify'
      };
    }
  }
}

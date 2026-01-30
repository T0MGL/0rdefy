/**
 * Warehouse Service
 * Manages picking and packing workflow for confirmed orders
 * Optimized for manual input without barcode scanners
 */

import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';

// ============================================================================
// BATCHED QUERY UTILITY
// PostgREST passes .in() filter values as URL query params. With 200+ UUIDs
// (36 chars each), the URL exceeds the ~8KB limit causing silent failures.
// This utility chunks large arrays into batches of 100 and merges results.
// ============================================================================
const IN_BATCH_SIZE = 100;

async function batchedSelect<T = any>(
  table: string,
  selectFields: string,
  filterColumn: string,
  filterValues: string[],
  additionalFilters?: (query: any) => any
): Promise<T[]> {
  if (filterValues.length === 0) return [];
  if (filterValues.length <= IN_BATCH_SIZE) {
    let query = supabaseAdmin.from(table).select(selectFields).in(filterColumn, filterValues);
    if (additionalFilters) query = additionalFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as T[];
  }

  const results: T[] = [];
  for (let i = 0; i < filterValues.length; i += IN_BATCH_SIZE) {
    const batch = filterValues.slice(i, i + IN_BATCH_SIZE);
    let query = supabaseAdmin.from(table).select(selectFields).in(filterColumn, batch);
    if (additionalFilters) query = additionalFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    if (data) results.push(...(data as T[]));
  }
  return results;
}

async function batchedUpdate(
  table: string,
  updateData: Record<string, any>,
  filterColumn: string,
  filterValues: string[],
  additionalFilters?: (query: any) => any
): Promise<void> {
  if (filterValues.length === 0) return;
  for (let i = 0; i < filterValues.length; i += IN_BATCH_SIZE) {
    const batch = filterValues.slice(i, i + IN_BATCH_SIZE);
    let query = supabaseAdmin.from(table).update(updateData).in(filterColumn, batch);
    if (additionalFilters) query = additionalFilters(query);
    const { error } = await query;
    if (error) throw error;
  }
}

async function batchedSelectWithRange<T = any>(
  table: string,
  selectFields: string,
  filterColumn: string,
  filterValues: string[]
): Promise<T[]> {
  if (filterValues.length === 0) return [];

  const results: T[] = [];
  for (let i = 0; i < filterValues.length; i += IN_BATCH_SIZE) {
    const batch = filterValues.slice(i, i + IN_BATCH_SIZE);
    const PAGE_SIZE = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select(selectFields)
        .in(filterColumn, batch)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      if (data && data.length > 0) {
        results.push(...(data as T[]));
        hasMore = data.length === PAGE_SIZE;
        page++;
      } else {
        hasMore = false;
      }
    }
  }
  return results;
}

export interface PickingSession {
  id: string;
  code: string;
  status: 'picking' | 'packing' | 'completed';
  user_id: string | null;
  store_id: string;
  created_at: string;
  updated_at: string;
  picking_started_at: string | null;
  picking_completed_at: string | null;
  packing_started_at: string | null;
  packing_completed_at: string | null;
  completed_at: string | null;
  order_count?: number;
  total_items?: number;
}

export interface PickingSessionItem {
  id: string;
  picking_session_id: string;
  product_id: string;
  variant_id?: string;
  total_quantity_needed: number;
  quantity_picked: number;
  created_at: string;
  updated_at: string;
  product_name?: string;
  product_image?: string;
  product_sku?: string;
  variant_title?: string;
  units_per_pack?: number;
  shelf_location?: string;
}

export interface PackingProgress {
  id: string;
  picking_session_id: string;
  order_id: string;
  product_id: string;
  variant_id?: string | null;  // NEW: variant support (Migration 108)
  quantity_needed: number;
  quantity_packed: number;
  created_at: string;
  updated_at: string;
}

export interface OrderForPacking {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address?: string;
  shipping_city?: string; // City for carrier coverage
  address_reference?: string;
  neighborhood?: string;
  delivery_notes?: string;
  delivery_link_token?: string;
  carrier_id?: string;
  carrier_name?: string;
  cod_amount?: number;
  total_price?: number;
  total_discounts?: number;
  payment_method?: string;
  payment_gateway?: string; // From Shopify: 'cash_on_delivery', 'shopify_payments', etc.
  financial_status?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided';
  printed?: boolean;
  printed_at?: string;
  created_at?: string;
  items: Array<{
    product_id: string;
    variant_id?: string | null;  // NEW: variant support (Migration 108)
    product_name: string;
    product_image: string;
    quantity_needed: number;
    quantity_packed: number;
  }>;
  is_complete: boolean;
}

/**
 * Creates a new picking session from confirmed orders
 */
export async function createSession(
  storeId: string,
  orderIds: string[],
  userId: string
): Promise<PickingSession> {
  try {
    // Log received order IDs for debugging

    // Validate that all order IDs are UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = orderIds.filter(id => !uuidRegex.test(id));

    if (invalidIds.length > 0) {
      throw new Error(
        `Invalid order IDs: ${invalidIds.join(', ')}. ` +
        `Expected UUIDs but received non-UUID values. ` +
        `This might indicate that Shopify order IDs are being used instead of internal UUIDs.`
      );
    }

    // ========================================================================
    // PRE-VALIDATION: Validate line items, product mapping, and stock
    // BEFORE creating the session. This prevents orphaned sessions when
    // validation fails after the atomic RPC has already committed.
    // ========================================================================

    // Fetch line items - support both Shopify (order_line_items) and manual (JSONB line_items)
    const normalizedLineItems = await batchedSelectWithRange(
      'order_line_items',
      'order_id, product_id, variant_id, quantity, shopify_product_id, shopify_variant_id, product_name, variant_title, units_per_pack',
      'order_id',
      orderIds
    );

    // VARIANT SUPPORT: Aggregate by (product_id, variant_id) composite key
    const productQuantities = new Map<string, {
      product_id: string;
      variant_id: string | null;
      variant_title: string | null;
      units_per_pack: number;
      quantity: number
    }>();

    if (normalizedLineItems && normalizedLineItems.length > 0) {
      // Check if any line items are missing product_id mapping
      const unmappedItems = normalizedLineItems.filter(item => !item.product_id);
      if (unmappedItems.length > 0) {
        const missingProductsList = unmappedItems
          .map(i => `• ${i.product_name} (Shopify Product ID: ${i.shopify_product_id})`)
          .join('\n');

        throw new Error(
          `❌ No se puede crear la sesión de preparación\n\n` +
          `Los siguientes ${unmappedItems.length} producto(s) NO existen en tu inventario de Ordefy:\n\n` +
          `${missingProductsList}\n\n` +
          `📋 Solución:\n` +
          `1. Ve a la página de Productos\n` +
          `2. Agrega manualmente estos productos a tu inventario\n` +
          `   O bien:\n` +
          `   Ve a Integraciones > Shopify y haz clic en "Sincronizar Productos"\n` +
          `3. Una vez agregados, vuelve a intentar crear la sesión de preparación`
        );
      }

      // Aggregate quantities from normalized line items by (product_id, variant_id)
      normalizedLineItems.forEach(item => {
        const productId = item.product_id;
        const variantId = item.variant_id || null;
        const quantity = parseInt(item.quantity, 10) || 0;
        if (productId) {
          const key = variantId ? `${productId}|${variantId}` : productId;
          const existing = productQuantities.get(key);
          if (existing) {
            existing.quantity += quantity;
          } else {
            productQuantities.set(key, {
              product_id: productId,
              variant_id: variantId,
              variant_title: item.variant_title || null,
              units_per_pack: item.units_per_pack || 1,
              quantity
            });
          }
        }
      });
    } else {
      // No normalized line items - must be manual orders
      const ordersWithLineItems = await batchedSelect(
        'orders',
        'id, line_items',
        'id',
        orderIds
      );

      ordersWithLineItems?.forEach(order => {
        if (Array.isArray(order.line_items)) {
          order.line_items.forEach((item: any) => {
            const productId = item.product_id;
            const variantId = item.variant_id || null;
            const quantity = parseInt(item.quantity, 10) || 0;
            if (productId) {
              const key = variantId ? `${productId}|${variantId}` : productId;
              const existing = productQuantities.get(key);
              if (existing) {
                existing.quantity += quantity;
              } else {
                productQuantities.set(key, {
                  product_id: productId,
                  variant_id: variantId,
                  variant_title: item.variant_title || null,
                  units_per_pack: item.units_per_pack || 1,
                  quantity
                });
              }
            }
          });
        }
      });
    }

    // Validate all product IDs are UUIDs
    const uniqueProductIds = new Set<string>();
    productQuantities.forEach((data) => {
      uniqueProductIds.add(data.product_id);
    });
    const invalidProductIds = Array.from(uniqueProductIds).filter(id => !uuidRegex.test(id));

    if (invalidProductIds.length > 0) {
      throw new Error(
        `Invalid product IDs detected: ${invalidProductIds.join(', ')}. ` +
        `Product IDs must be UUIDs. Check the order_line_items table for data corruption.`
      );
    }

    // STOCK VALIDATION: Check BEFORE creating session to prevent orphaned sessions
    const productIds = Array.from(uniqueProductIds);
    const stockData = await batchedSelect(
      'products',
      'id, name, stock, sku',
      'id',
      productIds,
      (q: any) => q.eq('store_id', storeId)
    );

    // Also fetch variant info for stock validation (shared stock calculation)
    const variantIds = Array.from(productQuantities.values())
      .filter(d => d.variant_id)
      .map(d => d.variant_id as string);

    let variantStockMap = new Map<string, { uses_shared_stock: boolean; units_per_pack: number; stock: number; variant_title: string }>();
    if (variantIds.length > 0) {
      const variantsData = await batchedSelect(
        'product_variants',
        'id, uses_shared_stock, units_per_pack, stock, variant_title',
        'id',
        variantIds
      );

      if (variantsData) {
        variantsData.forEach(v => {
          variantStockMap.set(v.id, {
            uses_shared_stock: v.uses_shared_stock || false,
            units_per_pack: v.units_per_pack || 1,
            stock: v.stock || 0,
            variant_title: v.variant_title
          });
        });
      }
    }

    const stockMap = new Map(stockData?.map(p => [p.id, { name: p.name, stock: p.stock || 0, sku: p.sku }]) || []);
    const insufficientStock: Array<{ name: string; sku: string; needed: number; available: number }> = [];

    const sharedStockNeeded = new Map<string, number>();

    productQuantities.forEach((data, key) => {
      const product = stockMap.get(data.product_id);
      if (!product) return;

      if (data.variant_id) {
        const variant = variantStockMap.get(data.variant_id);
        if (variant?.uses_shared_stock) {
          const unitsNeeded = data.quantity * (variant.units_per_pack || 1);
          const currentNeeded = sharedStockNeeded.get(data.product_id) || 0;
          sharedStockNeeded.set(data.product_id, currentNeeded + unitsNeeded);
        } else if (variant) {
          if (variant.stock < data.quantity) {
            insufficientStock.push({
              name: `${product.name} - ${variant.variant_title}`,
              sku: product.sku || 'N/A',
              needed: data.quantity,
              available: variant.stock
            });
          }
        }
      } else {
        if (product.stock < data.quantity) {
          insufficientStock.push({
            name: product.name || 'Producto sin nombre',
            sku: product.sku || 'N/A',
            needed: data.quantity,
            available: product.stock
          });
        }
      }
    });

    sharedStockNeeded.forEach((unitsNeeded, productId) => {
      const product = stockMap.get(productId);
      if (product && product.stock < unitsNeeded) {
        insufficientStock.push({
          name: product.name || 'Producto sin nombre',
          sku: product.sku || 'N/A',
          needed: unitsNeeded,
          available: product.stock
        });
      }
    });

    if (insufficientStock.length > 0) {
      const stockList = insufficientStock
        .map(p => `• ${p.name} (SKU: ${p.sku}) - Necesario: ${p.needed}, Disponible: ${p.available}`)
        .join('\n');

      throw new Error(
        `⚠️ Stock insuficiente para crear la sesión de preparación\n\n` +
        `Los siguientes productos no tienen suficiente inventario:\n\n` +
        `${stockList}\n\n` +
        `📋 Opciones:\n` +
        `1. Recibe mercadería (Ingresos) para aumentar el stock\n` +
        `2. Ajusta manualmente el stock en Productos\n` +
        `3. Excluye las órdenes con estos productos de la sesión`
      );
    }

    if (productQuantities.size === 0) {
      throw new Error('No valid products found in the selected orders');
    }

    // ========================================================================
    // SESSION CREATION: All validations passed, now create the session
    // ========================================================================

    // CRITICAL FIX (Bug #2): Use atomic RPC for session creation
    // This ensures all-or-nothing execution: session + orders + status update
    const { data: result, error: rpcError } = await supabaseAdmin
      .rpc('create_picking_session_atomic', {
        p_store_id: storeId,
        p_order_ids: orderIds,
        p_user_id: userId
      })
      .single();

    // Handle RPC errors
    if (rpcError) {
      // Check if function doesn't exist (old database version)
      if (rpcError.message?.includes('function') || rpcError.code === '42883') {
        logger.warn('WAREHOUSE', 'Atomic RPC not available, falling back to legacy non-atomic creation');
        // Fallback to legacy implementation (below)
      } else {
        throw rpcError;
      }
    }

    // If RPC succeeded, extract session data
    let session: any = null;
    if (result && result.success) {
      session = {
        id: result.session_id,
        code: result.session_code,
        status: result.session_status,
        user_id: userId,
        store_id: storeId
      };
    } else if (result && !result.success) {
      throw new Error(result.error_message || 'Error al crear sesión de picking');
    }

    // LEGACY FALLBACK (only if RPC doesn't exist)
    if (!session) {
      // 1. Validate that all orders exist and are confirmed
      const orders = await batchedSelect(
        'orders',
        'id, sleeves_status',
        'id',
        orderIds,
        (q: any) => q.eq('store_id', storeId)
      );

      if (!orders || orders.length === 0) {
        throw new Error('No se encontraron pedidos válidos');
      }

      const nonConfirmedOrders = orders.filter((o: any) => o.sleeves_status !== 'confirmed');
      if (nonConfirmedOrders.length > 0) {
        const statusCounts = nonConfirmedOrders.reduce((acc: Record<string, number>, o: any) => {
          const status = o.sleeves_status || 'sin_estado';
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, {});

        const statusSummary = Object.entries(statusCounts)
          .map(([status, count]) => `${count} en "${status}"`)
          .join(', ');

        throw new Error(
          `⚠️ No se puede crear la sesión de preparación\n\n` +
          `${nonConfirmedOrders.length} pedido(s) no están en estado "confirmado":\n` +
          `${statusSummary}\n\n` +
          `💡 Solo los pedidos confirmados pueden agregarse a una sesión de preparación.\n` +
          `Si los pedidos están en estado "contacted", debes confirmarlos primero.`
        );
      }

      // 2. Generate unique session code
      let sessionCode: string;
      const { data: codeData, error: codeError } = await supabaseAdmin
        .rpc('generate_session_code');

      if (codeError) {
        if (codeError.message?.includes('function') || codeError.code === '42883') {
          logger.warn('WAREHOUSE', 'generate_session_code RPC not available, using local generation');
          const now = new Date();
          const datePart = now.toLocaleDateString('es-PY', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }).replace(/\//g, '');
          const { count } = await supabaseAdmin
            .from('picking_sessions')
            .select('*', { count: 'exact', head: true })
            .eq('store_id', storeId)
            .gte('created_at', now.toISOString().split('T')[0]);
          const sequenceNum = (count || 0) + 1;
          sessionCode = `PREP-${datePart}-${String(sequenceNum).padStart(3, '0')}`;
        } else {
          throw codeError;
        }
      } else {
        sessionCode = codeData;
      }

      // 3. Create picking session
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from('picking_sessions')
        .insert({
          code: sessionCode,
          status: 'picking',
          user_id: userId,
          store_id: storeId,
          picking_started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (sessionError) throw sessionError;
      session = sessionData;

      // 4. Link orders to session
      const sessionOrders = orderIds.map(orderId => ({
        picking_session_id: session.id,
        order_id: orderId
      }));

      const { error: linkError } = await supabaseAdmin
        .from('picking_session_orders')
        .insert(sessionOrders);

      if (linkError) {
        await supabaseAdmin
          .from('picking_sessions')
          .delete()
          .eq('id', session.id);
        throw linkError;
      }

      // 5. Update orders status to in_preparation
      try {
        await batchedUpdate(
          'orders',
          { sleeves_status: 'in_preparation' },
          'id',
          orderIds
        );
      } catch (updateError) {
        await supabaseAdmin
          .from('picking_session_orders')
          .delete()
          .eq('picking_session_id', session.id);
        await supabaseAdmin
          .from('picking_sessions')
          .delete()
          .eq('id', session.id);
        throw updateError;
      }
    }

    // Insert aggregated picking list with variant support
    const pickingItems = Array.from(productQuantities.entries()).map(([key, data]) => ({
      picking_session_id: session.id,
      product_id: data.product_id,
      variant_id: data.variant_id,
      total_quantity_needed: data.quantity,
      quantity_picked: 0
    }));

    const { error: pickingItemsError } = await supabaseAdmin
      .from('picking_session_items')
      .insert(pickingItems);

    if (pickingItemsError) throw pickingItemsError;

    return session;
  } catch (error) {
    throw error;
  }
}

/**
 * Gets the aggregated picking list for a session
 */
export async function getPickingList(
  sessionId: string,
  storeId: string
): Promise<{
  items: PickingSessionItem[];
  orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
  }>;
}> {
  try {
    // Verify session belongs to store first
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('picking_sessions')
      .select('store_id')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      throw new Error('Sesión no encontrada');
    }
    if (session.store_id !== storeId) {
      throw new Error('Session does not belong to this store');
    }

    // Get picking session items
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('picking_session_items')
      .select('*')
      .eq('picking_session_id', sessionId);

    if (itemsError) throw itemsError;

    // Get product details separately
    // FIX: Guard against empty productIds - PostgREST .in() with empty array causes parse errors
    const productIds = items?.map(item => item.product_id) || [];
    let products: any[] = [];
    if (productIds.length > 0) {
      const { data, error: productsError } = await supabaseAdmin
        .from('products')
        .select('id, name, image_url, sku')
        .in('id', productIds);

      if (productsError) throw productsError;
      products = data || [];
    }

    // Get variant details if any items have variant_id
    const variantIds = (items || []).filter(item => item.variant_id).map(item => item.variant_id);
    let variantMap = new Map<string, { variant_title: string; units_per_pack: number }>();
    if (variantIds.length > 0) {
      const { data: variants } = await supabaseAdmin
        .from('product_variants')
        .select('id, variant_title, units_per_pack')
        .in('id', variantIds);

      if (variants) {
        variants.forEach(v => variantMap.set(v.id, { variant_title: v.variant_title, units_per_pack: v.units_per_pack || 1 }));
      }
    }

    // Create product map for quick lookup
    const productMap = new Map(products?.map(p => [p.id, p]) || []);

    // Format items with variant info
    const formattedItems = (items || []).map(item => {
      const product = productMap.get(item.product_id);
      const variant = item.variant_id ? variantMap.get(item.variant_id) : null;

      // Include variant title in product name if variant exists
      const displayName = variant
        ? `${product?.name || 'Producto desconocido'} - ${variant.variant_title}`
        : (product?.name || 'Producto desconocido');

      return {
        ...item,
        product_name: displayName,
        product_image: product?.image_url,
        product_sku: product?.sku,
        variant_title: variant?.variant_title,
        units_per_pack: variant?.units_per_pack || 1,
        shelf_location: undefined
      };
    });

    // Get orders in this session
    const { data: sessionOrders, error: ordersError } = await supabaseAdmin
      .from('picking_session_orders')
      .select(`
        order_id,
        orders (
          id,
          shopify_order_number,
          customer_first_name,
          customer_last_name
        )
      `)
      .eq('picking_session_id', sessionId);

    if (ordersError) throw ordersError;

    // Format orders
    const formattedOrders = (sessionOrders || []).map((so: any) => ({
      id: so.orders.id,
      order_number: so.orders.shopify_order_number || `ORD-${so.orders.id.slice(0, 8)}`,
      customer_name: `${so.orders.customer_first_name || ''} ${so.orders.customer_last_name || ''}`.trim() || 'Cliente'
    }));

    return {
      items: formattedItems,
      orders: formattedOrders
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Updates picking progress for a specific product (with variant support)
 * @param variantId - Optional variant ID. If provided, updates only that variant's picking progress.
 */
export async function updatePickingProgress(
  sessionId: string,
  productId: string,
  quantityPicked: number,
  storeId: string,
  variantId?: string | null  // NEW: variant support
): Promise<PickingSessionItem> {
  try {
    // VARIANT FIX: Try to use variant-aware RPC first (Migration 108)
    if (variantId !== undefined) {
      const { data: rpcResult, error: rpcError } = await supabaseAdmin
        .rpc('update_picking_progress_with_variant', {
          p_session_id: sessionId,
          p_product_id: productId,
          p_variant_id: variantId,
          p_quantity_picked: quantityPicked,
          p_store_id: storeId
        });

      if (!rpcError && rpcResult) {
        const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
        if (result) {
          return result as PickingSessionItem;
        }
      }

      // RPC failed or not available, fall through to legacy implementation
      if (rpcError && !rpcError.message?.includes('function') && rpcError.code !== '42883') {
        throw rpcError;
      }
      logger.warn('WAREHOUSE', 'update_picking_progress_with_variant RPC not available, using fallback');
    }

    // LEGACY FALLBACK (for backwards compatibility)
    // Verify session belongs to store
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('picking_sessions')
      .select('store_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (session.store_id !== storeId) {
      throw new Error('Session does not belong to this store');
    }
    if (session.status !== 'picking') {
      throw new Error('Session is not in picking status');
    }

    // Build query with variant support
    let itemQuery = supabaseAdmin
      .from('picking_session_items')
      .select('*')
      .eq('picking_session_id', sessionId)
      .eq('product_id', productId);

    // VARIANT FIX: Filter by variant_id if provided
    if (variantId) {
      itemQuery = itemQuery.eq('variant_id', variantId);
    } else {
      itemQuery = itemQuery.is('variant_id', null);
    }

    // VARIANT FIX: Fetch variant data if variantId provided
    const variantQuery = variantId
      ? supabaseAdmin
          .from('product_variants')
          .select('id, uses_shared_stock, units_per_pack, stock, variant_title')
          .eq('id', variantId)
          .single()
      : Promise.resolve({ data: null, error: null });

    const [itemResult, productResult, variantResult] = await Promise.all([
      itemQuery.single(),
      supabaseAdmin
        .from('products')
        .select('id, name, stock, sku')
        .eq('id', productId)
        .eq('store_id', storeId)
        .single(),
      variantQuery
    ]);

    if (itemResult.error) throw itemResult.error;
    if (productResult.error) throw productResult.error;

    const item = itemResult.data;
    const product = productResult.data;
    const variant = variantResult.data;

    // Validate quantity against what's needed
    if (quantityPicked < 0 || quantityPicked > item.total_quantity_needed) {
      throw new Error(`Cantidad inválida. Debe estar entre 0 y ${item.total_quantity_needed}`);
    }

    // VARIANT FIX: Proper stock validation based on variant type
    let availableStock: number;
    let displayName = product?.name || 'este producto';
    let stockUnit = 'unidades';

    if (variant) {
      displayName = `${product?.name} (${variant.variant_title})`;

      if (variant.uses_shared_stock) {
        // BUNDLE: Check parent stock, show availability in packs
        const unitsNeeded = quantityPicked * variant.units_per_pack;
        availableStock = product?.stock || 0;
        const availablePacks = Math.floor(availableStock / variant.units_per_pack);
        stockUnit = 'packs';

        if (unitsNeeded > availableStock) {
          throw new Error(
            `⚠️ Stock insuficiente para "${displayName}"\n\n` +
            `• SKU: ${product?.sku || 'N/A'}\n` +
            `• Intentas recoger: ${quantityPicked} packs (${unitsNeeded} unidades)\n` +
            `• Stock disponible: ${availablePacks} packs (${availableStock} unidades)\n\n` +
            `💡 Opciones:\n` +
            `1. Recibe mercadería para aumentar el stock\n` +
            `2. Reduce la cantidad a recoger a ${availablePacks} packs o menos`
          );
        }
      } else {
        // VARIATION: Check variant's independent stock
        availableStock = variant.stock || 0;

        if (quantityPicked > availableStock) {
          throw new Error(
            `⚠️ Stock insuficiente para "${displayName}"\n\n` +
            `• SKU: ${product?.sku || 'N/A'}\n` +
            `• Intentas recoger: ${quantityPicked} ${stockUnit}\n` +
            `• Stock disponible: ${availableStock} ${stockUnit}\n\n` +
            `💡 Opciones:\n` +
            `1. Recibe mercadería para aumentar el stock\n` +
            `2. Reduce la cantidad a recoger a ${availableStock} o menos`
          );
        }
      }
    } else {
      // No variant: check parent product stock directly
      availableStock = product?.stock || 0;
      if (quantityPicked > availableStock) {
        throw new Error(
          `⚠️ Stock insuficiente para "${displayName}"\n\n` +
          `• SKU: ${product?.sku || 'N/A'}\n` +
          `• Intentas recoger: ${quantityPicked} ${stockUnit}\n` +
          `• Stock disponible: ${availableStock} ${stockUnit}\n\n` +
          `💡 Opciones:\n` +
          `1. Recibe mercadería para aumentar el stock\n` +
          `2. Reduce la cantidad a recoger a ${availableStock} o menos`
        );
      }
    }

    // Build update query with variant support
    let updateQuery = supabaseAdmin
      .from('picking_session_items')
      .update({ quantity_picked: quantityPicked })
      .eq('picking_session_id', sessionId)
      .eq('product_id', productId);

    // VARIANT FIX: Filter by variant_id
    if (variantId) {
      updateQuery = updateQuery.eq('variant_id', variantId);
    } else {
      updateQuery = updateQuery.is('variant_id', null);
    }

    const { data: updated, error: updateError } = await updateQuery.select().single();

    if (updateError) throw updateError;

    return updated;
  } catch (error) {
    throw error;
  }
}

/**
 * Finishes picking phase and transitions to packing
 */
export async function finishPicking(
  sessionId: string,
  storeId: string
): Promise<PickingSession> {
  try {
    // Verify session belongs to store
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('picking_sessions')
      .select('store_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (session.store_id !== storeId) {
      throw new Error('Session does not belong to this store');
    }
    if (session.status !== 'picking') {
      throw new Error('Session is not in picking status');
    }

    // VARIANT FIX: Include variant_id in the query for proper stock validation
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('picking_session_items')
      .select('product_id, variant_id, total_quantity_needed, quantity_picked')
      .eq('picking_session_id', sessionId);

    if (itemsError) throw itemsError;

    const unpickedItems = items?.filter(
      item => item.quantity_picked < item.total_quantity_needed
    );

    if (unpickedItems && unpickedItems.length > 0) {
      throw new Error('Todos los productos deben ser recogidos antes de continuar');
    }

    // Re-validate stock before transitioning to packing phase
    // This catches cases where stock changed after session was created
    const productIds = items?.map(i => i.product_id) || [];
    const variantIds = items?.filter(i => i.variant_id).map(i => i.variant_id) || [];

    // Fetch product stock data
    // FIX: Guard against empty productIds - PostgREST .in() with empty array causes parse errors
    let stockData: any[] = [];
    if (productIds.length > 0) {
      const { data, error: stockError } = await supabaseAdmin
        .from('products')
        .select('id, name, stock, sku')
        .eq('store_id', storeId)
        .in('id', productIds);

      if (stockError) throw stockError;
      stockData = data || [];
    }

    // VARIANT FIX: Fetch variant data for proper stock calculation
    let variantStockMap = new Map<string, { uses_shared_stock: boolean; units_per_pack: number; stock: number; variant_title: string }>();
    if (variantIds.length > 0) {
      const { data: variantsData, error: variantsError } = await supabaseAdmin
        .from('product_variants')
        .select('id, uses_shared_stock, units_per_pack, stock, variant_title')
        .in('id', variantIds);

      if (!variantsError && variantsData) {
        variantsData.forEach(v => {
          variantStockMap.set(v.id, {
            uses_shared_stock: v.uses_shared_stock || false,
            units_per_pack: v.units_per_pack || 1,
            stock: v.stock || 0,
            variant_title: v.variant_title || ''
          });
        });
      }
    }

    const stockMap = new Map(stockData?.map(p => [p.id, { name: p.name, stock: p.stock || 0, sku: p.sku }]) || []);
    const insufficientStock: Array<{ name: string; sku: string; picked: number; available: number; unitsNeeded?: number }> = [];

    // VARIANT FIX: Calculate required stock based on variant type
    // For bundles (shared stock): needed units = picked packs * units_per_pack
    // For variations (independent stock): needed units = picked quantity
    items?.forEach(item => {
      const product = stockMap.get(item.product_id);
      if (!product) return;

      if (item.variant_id) {
        const variant = variantStockMap.get(item.variant_id);
        if (variant) {
          if (variant.uses_shared_stock) {
            // BUNDLE: Check parent product stock with units_per_pack multiplication
            const unitsNeeded = item.quantity_picked * variant.units_per_pack;
            if (product.stock < unitsNeeded) {
              insufficientStock.push({
                name: `${product.name} (${variant.variant_title})`,
                sku: product.sku || 'N/A',
                picked: item.quantity_picked,
                available: Math.floor(product.stock / variant.units_per_pack), // Show in packs
                unitsNeeded: unitsNeeded
              });
            }
          } else {
            // VARIATION: Check variant's independent stock
            if (variant.stock < item.quantity_picked) {
              insufficientStock.push({
                name: `${product.name} (${variant.variant_title})`,
                sku: product.sku || 'N/A',
                picked: item.quantity_picked,
                available: variant.stock
              });
            }
          }
        }
      } else {
        // No variant: check parent product stock directly
        if (product.stock < item.quantity_picked) {
          insufficientStock.push({
            name: product.name || 'Producto sin nombre',
            sku: product.sku || 'N/A',
            picked: item.quantity_picked,
            available: product.stock
          });
        }
      }
    });

    if (insufficientStock.length > 0) {
      const stockList = insufficientStock
        .map(p => `• ${p.name} (SKU: ${p.sku}) - Recogido: ${p.picked}, Disponible: ${p.available}`)
        .join('\n');

      throw new Error(
        `⚠️ Stock insuficiente detectado\n\n` +
        `El stock cambió mientras preparabas los pedidos:\n\n` +
        `${stockList}\n\n` +
        `💡 Opciones:\n` +
        `1. Cancela esta sesión y crea una nueva\n` +
        `2. Recibe mercadería para reponer el stock`
      );
    }

    // NOTE: Stock deduction is handled by the database trigger 'trigger_update_stock_on_order_status'
    // when orders transition to 'ready_to_ship' status in completeSession().
    // DO NOT deduct stock here to avoid double deduction.
    // See: db/migrations/019_inventory_management.sql

    // Initialize packing progress for each order item
    // Support both Shopify (order_line_items) and manual (JSONB line_items) orders
    const { data: sessionOrders, error: sessionOrdersError } = await supabaseAdmin
      .from('picking_session_orders')
      .select('order_id')
      .eq('picking_session_id', sessionId);

    if (sessionOrdersError) throw sessionOrdersError;

    const orderIdsInSession = sessionOrders?.map(so => so.order_id) || [];

    // VARIANT SUPPORT: Include variant_id in packing records
    const packingRecords: Array<{
      picking_session_id: string;
      order_id: string;
      product_id: string;
      variant_id?: string | null;
      quantity_needed: number;
      quantity_packed: number;
    }> = [];

    // First, try to get from normalized order_line_items table (Shopify orders)
    // BATCH FIX: Use batchedSelectWithRange to handle large order sets
    const normalizedLineItems = await batchedSelectWithRange(
      'order_line_items',
      'order_id, product_id, variant_id, quantity',
      'order_id',
      orderIdsInSession
    );

    if (normalizedLineItems && normalizedLineItems.length > 0) {
      // Aggregate quantities by (order_id, product_id, variant_id)
      const aggregatedItems = new Map<string, { order_id: string; product_id: string; variant_id: string | null; quantity: number }>();

      normalizedLineItems.forEach(item => {
        const productId = item.product_id;
        const variantId = item.variant_id || null;
        const quantity = parseInt(item.quantity, 10) || 0;
        if (productId) {
          // Composite key includes variant_id
          const key = variantId
            ? `${item.order_id}_${productId}_${variantId}`
            : `${item.order_id}_${productId}`;
          const existing = aggregatedItems.get(key);
          if (existing) {
            existing.quantity += quantity;
          } else {
            aggregatedItems.set(key, {
              order_id: item.order_id,
              product_id: productId,
              variant_id: variantId,
              quantity: quantity
            });
          }
        }
      });

      aggregatedItems.forEach(item => {
        packingRecords.push({
          picking_session_id: sessionId,
          order_id: item.order_id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity_needed: item.quantity,
          quantity_packed: 0
        });
      });
    } else {
      // No normalized line items - must be manual orders
      // BATCH FIX: Use batched query for large order sets
      const ordersWithItems = await batchedSelect(
        'orders',
        'id, line_items',
        'id',
        orderIdsInSession
      );

      // Aggregate quantities by (order_id, product_id, variant_id)
      const aggregatedManualItems = new Map<string, { order_id: string; product_id: string; variant_id: string | null; quantity: number }>();

      ordersWithItems?.forEach(order => {
        if (Array.isArray(order.line_items)) {
          order.line_items.forEach((item: any) => {
            const productId = item.product_id;
            const variantId = item.variant_id || null;
            const quantity = parseInt(item.quantity, 10) || 0;
            if (productId) {
              const key = variantId
                ? `${order.id}_${productId}_${variantId}`
                : `${order.id}_${productId}`;
              const existing = aggregatedManualItems.get(key);
              if (existing) {
                existing.quantity += quantity;
              } else {
                aggregatedManualItems.set(key, {
                  order_id: order.id,
                  product_id: productId,
                  variant_id: variantId,
                  quantity: quantity
                });
              }
            }
          });
        }
      });

      aggregatedManualItems.forEach(item => {
        packingRecords.push({
          picking_session_id: sessionId,
          order_id: item.order_id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity_needed: item.quantity,
          quantity_packed: 0
        });
      });
    }

    if (packingRecords.length > 0) {
      // FIX: Delete existing packing records before inserting (handles retry scenario).
      // If a previous finishPicking attempt partially inserted records but failed before
      // updating the session status, the session is still in 'picking' status and will
      // be retried. The old partial records would cause a UNIQUE constraint violation.
      await supabaseAdmin
        .from('packing_progress')
        .delete()
        .eq('picking_session_id', sessionId);

      const { error: packingError } = await supabaseAdmin
        .from('packing_progress')
        .insert(packingRecords);

      if (packingError) throw packingError;
    }

    // Update session status to packing
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('picking_sessions')
      .update({
        status: 'packing',
        picking_completed_at: new Date().toISOString(),
        packing_started_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (updateError) throw updateError;

    return updated;
  } catch (error) {
    throw error;
  }
}

/**
 * Gets the packing list with order details and progress
 */
export async function getPackingList(
  sessionId: string,
  storeId: string
): Promise<{
  session: PickingSession;
  orders: OrderForPacking[];
  availableItems: Array<{
    product_id: string;
    variant_id?: string | null;  // NEW: variant support (Migration 108)
    product_name: string;
    product_image: string;
    total_picked: number;
    total_packed: number;
    remaining: number;
  }>;
}> {
  try {
    // Verify session belongs to store
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('picking_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (session.store_id !== storeId) {
      throw new Error('Session does not belong to this store');
    }

    // Get orders in session with full details needed for printing
    const { data: sessionOrders, error: ordersError } = await supabaseAdmin
      .from('picking_session_orders')
      .select(`
        order_id,
        orders (
          id,
          shopify_order_number,
          shopify_order_name,
          shopify_order_id,
          customer_first_name,
          customer_last_name,
          customer_phone,
          customer_address,
          shipping_city,
          address_reference,
          neighborhood,
          delivery_notes,
          delivery_link_token,
          courier_id,
          cod_amount,
          total_price,
          total_discounts,
          payment_method,
          payment_gateway,
          financial_status,
          printed,
          printed_at,
          created_at
        )
      `)
      .eq('picking_session_id', sessionId);

    if (ordersError) throw ordersError;

    // Get packing progress
    const { data: packingProgress, error: progressError } = await supabaseAdmin
      .from('packing_progress')
      .select(`
        *,
        products!product_id (
          name,
          image_url
        )
      `)
      .eq('picking_session_id', sessionId);

    if (progressError) throw progressError;

    // Get carrier details for orders (do this in a separate query for simplicity)
    // FIX: Null-safe access to so.orders (can be null if order was deleted while in session)
    const orderIds = sessionOrders
      ?.filter((so: any) => so.orders?.id)
      .map((so: any) => so.orders.id) || [];

    // Extract unique carrier IDs from orders to avoid N+1 query
    const carrierIds = [...new Set(
      sessionOrders
        ?.map((so: any) => so.orders?.courier_id)
        .filter(Boolean)
    )] || [];

    // FIX: Guard against empty carrierIds - PostgREST .in() with empty array can cause parse errors
    let carrierMap = new Map<string, string>();
    if (carrierIds.length > 0) {
      const { data: carriersData } = await supabaseAdmin
        .from('carriers')
        .select('id, name')
        .in('id', carrierIds);

      carrierMap = new Map(carriersData?.map(c => [c.id, c.name]) || []);
    }

    // Get ALL order line items (not just packing_progress)
    // This ensures we show ALL products in the order, even if not yet packed
    // FIX: Don't use embedded join `products (...)` because it fails when product_id
    // contains invalid UUIDs (e.g., Shopify numeric IDs that weren't mapped properly).
    // Instead, fetch products separately with UUID validation.
    const orderLineItems = await batchedSelectWithRange(
      'order_line_items',
      `order_id, product_id, variant_id, product_name, variant_title, quantity`,
      'order_id',
      orderIds
    );

    // Also fetch JSONB line_items for manual orders (fallback)
    const ordersWithJsonbItems = await batchedSelect(
      'orders',
      'id, line_items',
      'id',
      orderIds
    );

    // Create a map of JSONB line items by order_id for fallback
    const jsonbLineItemsMap = new Map<string, any[]>();
    ordersWithJsonbItems?.forEach((order: any) => {
      if (Array.isArray(order.line_items) && order.line_items.length > 0) {
        jsonbLineItemsMap.set(order.id, order.line_items);
      }
    });

    // Collect ALL product IDs (from normalized + JSONB) and filter to valid UUIDs only
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const allProductIds = new Set<string>();

    // From normalized line items
    orderLineItems?.forEach((li: any) => {
      if (li.product_id && uuidRegex.test(li.product_id)) {
        allProductIds.add(li.product_id);
      }
    });

    // From JSONB line items
    jsonbLineItemsMap.forEach((items) => {
      items.forEach((item: any) => {
        if (item.product_id && uuidRegex.test(item.product_id)) {
          allProductIds.add(item.product_id);
        }
      });
    });

    // Fetch product details for ALL valid product IDs
    const productsMap = new Map<string, any>();
    if (allProductIds.size > 0) {
      const products = await batchedSelect(
        'products',
        'id, name, image_url',
        'id',
        Array.from(allProductIds)
      );

      products?.forEach((p: any) => {
        productsMap.set(p.id, p);
      });
    }

    // Create a map of packing progress for quick lookup
    // VARIANT SUPPORT: Key includes variant_id for correct matching
    const packingProgressMap = new Map<string, { quantity_needed: number; quantity_packed: number; variant_id: string | null }>();
    packingProgress?.forEach((p: any) => {
      // Key format: "order_id-product_id" or "order_id-product_id-variant_id"
      const key = p.variant_id
        ? `${p.order_id}-${p.product_id}-${p.variant_id}`
        : `${p.order_id}-${p.product_id}`;
      packingProgressMap.set(key, {
        quantity_needed: p.quantity_needed,
        quantity_packed: p.quantity_packed,
        variant_id: p.variant_id || null
      });
    });

    // PERF FIX: Pre-group normalized line items by order_id for O(1) lookup
    // Previously used .filter() per order which was O(orders × lineItems)
    const normalizedItemsByOrderId = new Map<string, any[]>();
    orderLineItems?.forEach((li: any) => {
      const existing = normalizedItemsByOrderId.get(li.order_id);
      if (existing) {
        existing.push(li);
      } else {
        normalizedItemsByOrderId.set(li.order_id, [li]);
      }
    });

    // Format orders with their items
    // FIX: Filter out null orders (can happen if order was deleted while in session)
    const orders: OrderForPacking[] = sessionOrders?.filter((so: any) => so.orders?.id).map((so: any) => {
      const order = so.orders;

      // Get line items from normalized table (Shopify) or JSONB fallback (manual orders)
      const normalizedItems = normalizedItemsByOrderId.get(order.id) || [];
      const jsonbItems = jsonbLineItemsMap.get(order.id) || [];

      // Use normalized items if available, otherwise fallback to JSONB
      const useNormalized = normalizedItems.length > 0;
      const orderItems = useNormalized ? normalizedItems : jsonbItems;

      // Aggregate items by (product_id, variant_id) - VARIANT SUPPORT
      const aggregatedItemsMap = new Map<string, {
        product_id: string;
        variant_id: string | null;
        product_name: string;
        product_image: string;
        quantity_needed: number;
        quantity_packed: number;
      }>();

      orderItems.forEach((lineItem: any) => {
        const productId = lineItem.product_id;
        const variantId = lineItem.variant_id || null;
        if (!productId) return;

        // VARIANT SUPPORT: Key includes variant_id
        const progressKey = variantId
          ? `${order.id}-${productId}-${variantId}`
          : `${order.id}-${productId}`;
        const progress = packingProgressMap.get(progressKey);

        // FIX: Use productsMap for both normalized and JSONB line items
        // This ensures we handle invalid UUIDs gracefully (productsMap only has valid products)
        const product = productsMap.get(productId);
        const baseName = product?.name || lineItem.product_name || lineItem.name || 'Producto';
        const productName = lineItem.variant_title
          ? `${baseName} - ${lineItem.variant_title}`
          : baseName;
        const productImage = product?.image_url || lineItem.image_url || '';
        const itemQuantity = parseInt(lineItem.quantity, 10) || 0;

        // Composite key for aggregation includes variant_id
        const aggregationKey = variantId ? `${productId}-${variantId}` : productId;
        const existing = aggregatedItemsMap.get(aggregationKey);
        if (existing) {
          // Same product+variant exists - add quantities
          existing.quantity_needed += progress?.quantity_needed || itemQuantity;
          existing.quantity_packed += progress?.quantity_packed || 0;
        } else {
          aggregatedItemsMap.set(aggregationKey, {
            product_id: productId,
            variant_id: variantId,
            product_name: productName,
            product_image: productImage,
            quantity_needed: progress?.quantity_needed || itemQuantity,
            quantity_packed: progress?.quantity_packed || 0
          });
        }
      });

      // CRITICAL FIX: Include orphaned packing_progress records that don't have corresponding line items
      // This prevents the UI from showing "complete" when there are actually unpacked items
      packingProgress?.forEach((p: any) => {
        if (p.order_id !== order.id) return;

        // VARIANT SUPPORT: Check using composite key
        const aggregationKey = p.variant_id ? `${p.product_id}-${p.variant_id}` : p.product_id;
        const existing = aggregatedItemsMap.get(aggregationKey);
        if (!existing) {
          // This is an orphaned packing_progress record - include it so UI shows correct state
          const orphanProduct = productsMap.get(p.product_id);
          aggregatedItemsMap.set(aggregationKey, {
            product_id: p.product_id,
            variant_id: p.variant_id || null,
            product_name: orphanProduct?.name || p.products?.name || 'Producto (huérfano)',
            product_image: orphanProduct?.image_url || '',
            quantity_needed: p.quantity_needed,
            quantity_packed: p.quantity_packed
          });
        }
        // Note: If the product already exists in aggregatedItemsMap (from orderItems),
        // it was already processed with its packing_progress data, so no need to update
      });

      const items = Array.from(aggregatedItemsMap.values());

      const is_complete = items.length > 0 && items.every(item => item.quantity_packed >= item.quantity_needed);

      return {
        id: order.id,
        order_number: order.shopify_order_name || order.shopify_order_number || `ORD-${order.id.slice(0, 8)}`,
        customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
        customer_phone: order.customer_phone,
        customer_address: order.customer_address,
        shipping_city: order.shipping_city,
        address_reference: order.address_reference,
        neighborhood: order.neighborhood,
        delivery_notes: order.delivery_notes,
        delivery_link_token: order.delivery_link_token,
        carrier_id: order.courier_id,
        carrier_name: order.courier_id ? carrierMap.get(order.courier_id) : undefined,
        cod_amount: order.cod_amount,
        total_price: order.total_price,
        total_discounts: order.total_discounts,
        payment_method: order.payment_method,
        payment_gateway: order.payment_gateway,
        financial_status: order.financial_status,
        printed: order.printed,
        printed_at: order.printed_at,
        created_at: order.created_at,
        items,
        is_complete
      };
    }) || [];

    // Get available items (basket) from picking_session_items
    const { data: pickedItems, error: pickedError } = await supabaseAdmin
      .from('picking_session_items')
      .select(`
        *,
        products!product_id (
          name,
          image_url
        )
      `)
      .eq('picking_session_id', sessionId);

    if (pickedError) throw pickedError;

    // VARIANT FIX: Calculate total packed per (product, variant) combination
    const packedByProductVariant = new Map<string, number>();
    packingProgress?.forEach(p => {
      // VARIANT SUPPORT: Key includes variant_id
      const key = p.variant_id ? `${p.product_id}|${p.variant_id}` : p.product_id;
      const current = packedByProductVariant.get(key) || 0;
      packedByProductVariant.set(key, current + p.quantity_packed);
    });

    // VARIANT FIX: Calculate total needed per (product, variant) from packing_progress
    const neededByProductVariant = new Map<string, number>();
    packingProgress?.forEach(p => {
      // VARIANT SUPPORT: Key includes variant_id
      const key = p.variant_id ? `${p.product_id}|${p.variant_id}` : p.product_id;
      const current = neededByProductVariant.get(key) || 0;
      neededByProductVariant.set(key, current + p.quantity_needed);
    });

    // VARIANT FIX: Fetch variant info for picking_session_items
    const pickingVariantIds = (pickedItems || []).filter(item => item.variant_id).map(item => item.variant_id);
    let pickingVariantMap = new Map<string, string>();
    if (pickingVariantIds.length > 0) {
      const { data: pickingVariants } = await supabaseAdmin
        .from('product_variants')
        .select('id, variant_title')
        .in('id', pickingVariantIds);

      if (pickingVariants) {
        pickingVariants.forEach(v => pickingVariantMap.set(v.id, v.variant_title));
      }
    }

    // VARIANT FIX: Build availableItems from picking_session_items keyed by (product, variant)
    const availableItemsMap = new Map<string, any>();
    pickedItems?.forEach(item => {
      // VARIANT SUPPORT: Key includes variant_id
      const key = item.variant_id ? `${item.product_id}|${item.variant_id}` : item.product_id;
      const variantTitle = item.variant_id ? pickingVariantMap.get(item.variant_id) : null;
      const productName = variantTitle
        ? `${item.products?.name || ''} - ${variantTitle}`
        : (item.products?.name || '');

      availableItemsMap.set(key, {
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        product_name: productName,
        product_image: item.products?.image_url || '',
        total_picked: item.quantity_picked,
        total_packed: packedByProductVariant.get(key) || 0,
        remaining: item.quantity_picked - (packedByProductVariant.get(key) || 0)
      });
    });

    // FALLBACK: If a (product, variant) is in packing_progress but NOT in picking_session_items,
    // add it to availableItems using quantity_needed as total_picked
    // This handles sessions created before the JSONB fix
    // VARIANT FIX: Now uses composite key (product|variant)
    neededByProductVariant.forEach((totalNeeded, key) => {
      if (!availableItemsMap.has(key)) {
        // Parse the key to get product_id and variant_id
        const [productId, variantId] = key.includes('|') ? key.split('|') : [key, null];
        // Find product details from productsMap or fetch from packing_progress
        const product = productsMap.get(productId);
        const variantTitle = variantId ? pickingVariantMap.get(variantId) : null;
        const productName = variantTitle
          ? `${product?.name || 'Producto'} - ${variantTitle}`
          : (product?.name || 'Producto');
        const packed = packedByProductVariant.get(key) || 0;
        availableItemsMap.set(key, {
          product_id: productId,
          variant_id: variantId || null,
          product_name: productName,
          product_image: product?.image_url || '',
          total_picked: totalNeeded, // Use needed as picked (auto-complete picking)
          total_packed: packed,
          remaining: totalNeeded - packed
        });
      }
    });

    const availableItems = Array.from(availableItemsMap.values());

    return {
      session,
      orders,
      availableItems
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Assigns one unit of a product to an order (packing)
 * @param variantId - Optional variant ID. If provided, updates only that variant's packing progress.
 */
export async function updatePackingProgress(
  sessionId: string,
  orderId: string,
  productId: string,
  storeId: string,
  variantId?: string | null  // NEW: variant support
): Promise<PackingProgress> {
  try {
    // VARIANT FIX: Try to use variant-aware RPC first (Migration 108)
    const { data: rpcResult, error: rpcError } = await supabaseAdmin
      .rpc('update_packing_progress_with_variant', {
        p_session_id: sessionId,
        p_order_id: orderId,
        p_product_id: productId,
        p_variant_id: variantId || null,
        p_store_id: storeId
      });

    if (!rpcError && rpcResult) {
      const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
      if (result) {
        return result as PackingProgress;
      }
    }

    // If RPC not available, fall through to legacy with variant filter
    if (rpcError && !rpcError.message?.includes('function') && rpcError.code !== '42883') {
      throw rpcError;
    }

    logger.warn('WAREHOUSE', 'update_packing_progress_with_variant RPC not available, using fallback');

    // LEGACY FALLBACK with variant support
    // Verify session belongs to store and is in packing status
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('picking_sessions')
      .select('store_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (session.store_id !== storeId) {
      throw new Error('Session does not belong to this store');
    }
    if (session.status !== 'packing') {
      throw new Error('Session is not in packing status');
    }

    // CRITICAL: Check order status before allowing packing modifications
    // Block if order reached ready_to_ship (stock decremented) OR was cancelled/rejected
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('sleeves_status, order_number')
      .eq('id', orderId)
      .single();

    if (orderError) throw orderError;

    // Block completed orders (stock already decremented)
    if (['ready_to_ship', 'shipped', 'in_transit', 'delivered'].includes(order.sleeves_status)) {
      throw new Error(
        `Cannot modify packing - order ${order.order_number || orderId} has already been completed ` +
        `(status: ${order.sleeves_status}) and stock was decremented. ` +
        'This order is now locked to maintain inventory accuracy.'
      );
    }

    // Block cancelled/rejected orders (shouldn't be packed)
    if (['cancelled', 'rejected', 'returned'].includes(order.sleeves_status)) {
      throw new Error(
        `Cannot modify packing - order ${order.order_number || orderId} has been ${order.sleeves_status}. ` +
        'Remove this order from the picking session.'
      );
    }

    // Build query with variant support
    let progressQuery = supabaseAdmin
      .from('packing_progress')
      .select('*')
      .eq('picking_session_id', sessionId)
      .eq('order_id', orderId)
      .eq('product_id', productId);

    // VARIANT FIX: Filter by variant_id
    if (variantId) {
      progressQuery = progressQuery.eq('variant_id', variantId);
    } else {
      progressQuery = progressQuery.is('variant_id', null);
    }

    const { data: progressRecords, error: progressError } = await progressQuery;

    if (progressError) throw progressError;

    if (!progressRecords || progressRecords.length === 0) {
      throw new Error('No packing progress found for this item');
    }

    // Aggregate quantities from all records (handles duplicate product entries)
    const totalQuantityNeeded = progressRecords.reduce((sum, p) => sum + (p.quantity_needed || 0), 0);
    const totalQuantityPacked = progressRecords.reduce((sum, p) => sum + (p.quantity_packed || 0), 0);

    // Use the first record for updates (we'll update the first one that has capacity)
    const progress = progressRecords.find(p => p.quantity_packed < p.quantity_needed) || progressRecords[0];

    // Check if already fully packed
    if (totalQuantityPacked >= totalQuantityNeeded) {
      throw new Error('This item is already fully packed for this order');
    }

    // Build picking items query with variant support
    let pickedItemQuery = supabaseAdmin
      .from('picking_session_items')
      .select('quantity_picked')
      .eq('picking_session_id', sessionId)
      .eq('product_id', productId);

    // VARIANT FIX: Filter by variant_id
    if (variantId) {
      pickedItemQuery = pickedItemQuery.eq('variant_id', variantId);
    } else {
      pickedItemQuery = pickedItemQuery.is('variant_id', null);
    }

    const { data: pickedItem, error: pickedError } = await pickedItemQuery.single();

    if (pickedError) throw pickedError;

    // Build total packed query with variant support
    let allPackedQuery = supabaseAdmin
      .from('packing_progress')
      .select('quantity_packed')
      .eq('picking_session_id', sessionId)
      .eq('product_id', productId);

    // VARIANT FIX: Filter by variant_id
    if (variantId) {
      allPackedQuery = allPackedQuery.eq('variant_id', variantId);
    } else {
      allPackedQuery = allPackedQuery.is('variant_id', null);
    }

    const { data: allPacked, error: allPackedError } = await allPackedQuery;

    if (allPackedError) throw allPackedError;

    const totalPacked = allPacked?.reduce((sum, p) => sum + p.quantity_packed, 0) || 0;

    if (totalPacked >= pickedItem.quantity_picked) {
      throw new Error('No more units of this item available to pack');
    }

    // Try atomic RPC with variant support (Migration 108)
    const { data: updated, error: updateError } = await supabaseAdmin
      .rpc('increment_packing_quantity', {
        p_progress_id: progress.id,
        p_quantity_needed: progress.quantity_needed,
        p_picked_quantity: pickedItem.quantity_picked,
        p_session_id: sessionId,
        p_product_id: productId,
        p_variant_id: variantId || null  // NEW: pass variant_id to RPC
      });

    if (updateError) {
      // Final fallback: use optimistic locking with CAS (Compare-And-Swap)
      // This is less ideal but prevents total failure if RPC doesn't exist
      // IMPORTANT: Add retry logic to handle concurrent updates (M-2 FIX)
      const MAX_CAS_RETRIES = 3;
      let casAttempt = 0;
      let casSuccess = false;
      let casResult: any = null;

      while (casAttempt < MAX_CAS_RETRIES && !casSuccess) {
        try {
          // RACE CONDITION FIX: Include variant_id in re-read to ensure consistency
          let rereadQuery = supabaseAdmin
            .from('packing_progress')
            .select('quantity_packed, quantity_needed, variant_id')
            .eq('id', progress.id);

          const { data: reread, error: rereadError } = await rereadQuery.single();

          if (rereadError) throw rereadError;

          // RACE CONDITION FIX: Verify variant_id hasn't changed (prevents cross-variant updates)
          const expectedVariantId = variantId || null;
          const actualVariantId = reread.variant_id || null;
          if (expectedVariantId !== actualVariantId) {
            throw new Error(`Variant mismatch detected: expected ${expectedVariantId}, got ${actualVariantId}. Concurrent update detected.`);
          }

          // Double-check we haven't exceeded limits
          if (reread.quantity_packed >= reread.quantity_needed) {
            throw new Error('This item is already fully packed for this order');
          }

          // RACE CONDITION FIX: Build CAS update with variant_id verification
          let casUpdateQuery = supabaseAdmin
            .from('packing_progress')
            .update({ quantity_packed: reread.quantity_packed + 1 })
            .eq('id', progress.id)
            .eq('quantity_packed', reread.quantity_packed); // CAS condition

          // Add variant_id to CAS condition for additional safety
          if (variantId) {
            casUpdateQuery = casUpdateQuery.eq('variant_id', variantId);
          } else {
            casUpdateQuery = casUpdateQuery.is('variant_id', null);
          }

          const { data: casUpdated, error: casError } = await casUpdateQuery
            .select()
            .single();

          if (casError) throw casError;

          if (!casUpdated) {
            // CAS failed - concurrent update detected, retry
            casAttempt++;
            if (casAttempt < MAX_CAS_RETRIES) {
              // Small exponential backoff: 10ms, 20ms, 40ms
              await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, casAttempt)));
              continue;
            }
            throw new Error('Concurrent update detected after max retries. Please try again.');
          }

          casSuccess = true;
          casResult = casUpdated;
        } catch (error) {
          // If it's a validation error (already packed), throw immediately
          if (error instanceof Error && error.message.includes('already fully packed')) {
            throw error;
          }
          // Otherwise, if we've exhausted retries, throw
          if (casAttempt >= MAX_CAS_RETRIES - 1) {
            throw error;
          }
          casAttempt++;
          await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, casAttempt)));
        }
      }

      if (!casSuccess || !casResult) {
        throw new Error('Failed to update packing progress after retries');
      }

      return casResult;
    }

    // RPC returns array of rows, get first one
    const updatedRecord = Array.isArray(updated) ? updated[0] : updated;

    // Validate RPC returned a record
    if (!updatedRecord) {
      throw new Error('Failed to update packing progress - no record returned from database');
    }

    return updatedRecord;
  } catch (error) {
    throw error;
  }
}

/**
 * Gets all active picking sessions for a store
 */
export async function getActiveSessions(storeId: string): Promise<PickingSession[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('picking_sessions')
      .select(`
        *,
        order_count:picking_session_orders(count)
      `)
      .eq('store_id', storeId)
      .in('status', ['picking', 'packing'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Transform order_count from [{count: N}] to N
    const sessions = (data || []).map((session: any) => ({
      ...session,
      order_count: Array.isArray(session.order_count) && session.order_count[0]
        ? session.order_count[0].count
        : 0
    }));

    return sessions;
  } catch (error) {
    throw error;
  }
}

/**
 * Gets all confirmed orders ready for preparation
 */
export async function getConfirmedOrders(storeId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        shopify_order_number,
        shopify_order_id,
        customer_first_name,
        customer_last_name,
        customer_phone,
        created_at,
        line_items,
        carriers:courier_id (name)
      `)
      .eq('store_id', storeId)
      .eq('sleeves_status', 'confirmed')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate total_items from JSONB line_items and format customer name
    const ordersWithCounts = (data || []).map((order: any) => {
      // Validate that id is a UUID (not a Shopify ID)
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.id);

      return {
        id: order.id,
        order_number: order.shopify_order_number || `ORD-${order.id.slice(0, 8)}`,
        customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
        customer_phone: order.customer_phone,
        created_at: order.created_at,
        carrier_name: order.carriers?.name || 'Sin transportadora',
        total_items: Array.isArray(order.line_items)
          ? order.line_items.reduce((sum: number, item: any) => sum + (parseInt(item.quantity, 10) || 0), 0)
          : 0
      };
    });

    return ordersWithCounts;
  } catch (error) {
    throw error;
  }
}

/**
 * Abandons a picking session and restores orders to confirmed
 */
export async function abandonSession(
  sessionId: string,
  storeId: string,
  userId: string | null,
  reason?: string
): Promise<any> {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('abandon_picking_session', {
        p_session_id: sessionId,
        p_store_id: storeId,
        p_user_id: userId,
        p_reason: reason || 'Sesión abandonada por el usuario'
      });

    if (error) {
      // Fallback if RPC not available
      if (error.message?.includes('function') || error.code === '42883') {
        return await abandonSessionFallback(sessionId, storeId, userId, reason);
      }
      throw error;
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Fallback for abandonSession when RPC is not available
 */
async function abandonSessionFallback(
  sessionId: string,
  storeId: string,
  userId: string | null,
  reason?: string
): Promise<any> {
  // Verify session exists and belongs to store
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('picking_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('store_id', storeId)
    .single();

  if (sessionError || !session) {
    throw new Error('Session not found or does not belong to this store');
  }

  if (session.status === 'completed') {
    throw new Error('Cannot abandon a completed session');
  }

  // Get orders in session
  const { data: sessionOrders } = await supabaseAdmin
    .from('picking_session_orders')
    .select('order_id')
    .eq('picking_session_id', sessionId);

  const orderIds = sessionOrders?.map(so => so.order_id) || [];

  // Restore orders to confirmed
  // BATCH FIX: Use batched update for large order sets
  let ordersRestored = 0;
  if (orderIds.length > 0) {
    for (let i = 0; i < orderIds.length; i += IN_BATCH_SIZE) {
      const batch = orderIds.slice(i, i + IN_BATCH_SIZE);
      const { data: updated } = await supabaseAdmin
        .from('orders')
        .update({ sleeves_status: 'confirmed', updated_at: new Date().toISOString() })
        .eq('store_id', storeId)
        .eq('sleeves_status', 'in_preparation')
        .in('id', batch)
        .select();

      ordersRestored += updated?.length || 0;
    }
  }

  // Mark session as completed (abandoned)
  await supabaseAdmin
    .from('picking_sessions')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  return {
    success: true,
    session_id: sessionId,
    session_code: session.code,
    orders_restored: ordersRestored,
    total_orders: orderIds.length,
    abandoned_at: new Date().toISOString(),
    reason: reason || 'Sesión abandonada por el usuario'
  };
}

/**
 * Removes a single order from a session
 */
export async function removeOrderFromSession(
  sessionId: string,
  orderId: string,
  storeId: string
): Promise<any> {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('remove_order_from_session', {
        p_session_id: sessionId,
        p_order_id: orderId,
        p_store_id: storeId
      });

    if (error) {
      // Fallback if RPC not available
      if (error.message?.includes('function') || error.code === '42883') {
        return await removeOrderFromSessionFallback(sessionId, orderId, storeId);
      }
      throw error;
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Fallback for removeOrderFromSession when RPC is not available
 */
async function removeOrderFromSessionFallback(
  sessionId: string,
  orderId: string,
  storeId: string
): Promise<any> {
  // Verify session
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('picking_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('store_id', storeId)
    .single();

  if (sessionError || !session) {
    throw new Error('Sesión no encontrada');
  }

  if (session.status === 'completed') {
    throw new Error('Cannot modify a completed session');
  }

  // Check order exists in session
  const { data: sessionOrder } = await supabaseAdmin
    .from('picking_session_orders')
    .select('*')
    .eq('picking_session_id', sessionId)
    .eq('order_id', orderId)
    .single();

  if (!sessionOrder) {
    throw new Error('Order not found in this session');
  }

  // Get order details
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('store_id', storeId)
    .single();

  // SECURITY: Verify order belongs to this store before any modifications
  if (!order) {
    throw new Error('Order not found or does not belong to this store');
  }

  // Restore order to confirmed if still in_preparation
  // SECURITY FIX: Add store_id filter to prevent cross-store updates
  if (order.sleeves_status === 'in_preparation') {
    await supabaseAdmin
      .from('orders')
      .update({ sleeves_status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('store_id', storeId);  // CRITICAL: Ensure order belongs to this store
  }

  // Remove from session
  await supabaseAdmin
    .from('picking_session_orders')
    .delete()
    .eq('picking_session_id', sessionId)
    .eq('order_id', orderId);

  // Remove packing progress
  // SECURITY: Already verified order belongs to store above, safe to proceed
  await supabaseAdmin
    .from('packing_progress')
    .delete()
    .eq('picking_session_id', sessionId)
    .eq('order_id', orderId);

  // Check remaining orders
  const { data: remainingOrders } = await supabaseAdmin
    .from('picking_session_orders')
    .select('order_id')
    .eq('picking_session_id', sessionId);

  const remainingCount = remainingOrders?.length || 0;

  // Auto-abandon if no orders left
  if (remainingCount === 0) {
    await abandonSession(sessionId, storeId, null, 'Auto-abandoned: No orders remaining');
  }

  return {
    success: true,
    order_id: orderId,
    order_number: order?.shopify_order_number,
    remaining_orders: remainingCount,
    session_abandoned: remainingCount === 0
  };
}

/**
 * Cleans up expired sessions
 */
export async function cleanupExpiredSessions(hoursInactive: number = 48): Promise<any> {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('cleanup_expired_sessions', {
        p_hours_inactive: hoursInactive
      });

    if (error) {
      // Fallback if RPC not available
      if (error.message?.includes('function') || error.code === '42883') {
        return { success: false, message: 'Migration 058 required for this feature' };
      }
      throw error;
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Gets stale sessions for a store
 */
export async function getStaleSessions(storeId: string): Promise<any[]> {
  try {
    // Try to use the view first
    const { data, error } = await supabaseAdmin
      .from('picking_sessions')
      .select(`
        id,
        code,
        status,
        created_at,
        updated_at,
        picking_started_at,
        packing_started_at
      `)
      .eq('store_id', storeId)
      .in('status', ['picking', 'packing'])
      .order('updated_at', { ascending: true });

    if (error) throw error;

    // Calculate staleness for each session
    const now = new Date();
    const staleSessions = (data || []).map(session => {
      const lastActivity = new Date(session.updated_at);
      const inactiveHours = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);

      return {
        ...session,
        inactive_hours: Math.round(inactiveHours * 10) / 10,
        staleness_level: inactiveHours > 48 ? 'CRITICAL' : inactiveHours > 24 ? 'WARNING' : 'OK'
      };
    });

    return staleSessions;
  } catch (error) {
    throw error;
  }
}

/**
 * Updates packing progress using atomic RPC (with row locking)
 * @param variantId - Optional variant ID. If provided, updates only that variant's packing progress.
 */
export async function updatePackingProgressAtomic(
  sessionId: string,
  orderId: string,
  productId: string,
  storeId: string,
  variantId?: string | null  // NEW: variant support
): Promise<any> {
  try {
    // VARIANT FIX: Use variant-aware RPC (Migration 108)
    const { data, error } = await supabaseAdmin
      .rpc('update_packing_progress_with_variant', {
        p_session_id: sessionId,
        p_order_id: orderId,
        p_product_id: productId,
        p_variant_id: variantId || null,
        p_store_id: storeId
      });

    if (error) {
      // Fallback to existing implementation if RPC not available
      if (error.message?.includes('function') || error.code === '42883') {
        return await updatePackingProgress(sessionId, orderId, productId, storeId, variantId);
      }
      throw error;
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Completes a picking session
 */
export async function completeSession(
  sessionId: string,
  storeId: string
): Promise<PickingSession> {
  try {
    // Verify session belongs to store
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('picking_sessions')
      .select('store_id, status')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (session.store_id !== storeId) {
      throw new Error('Session does not belong to this store');
    }

    // Get all packing progress for this session (direct query, no JOINs to avoid orphan issues)
    const { data: packingProgress, error: progressError } = await supabaseAdmin
      .from('packing_progress')
      .select('*')
      .eq('picking_session_id', sessionId);

    if (progressError) throw progressError;

    // Verify all items are fully packed (raw check without JOINs)
    const notPacked = packingProgress?.filter(
      p => p.quantity_packed < p.quantity_needed
    );

    if (notPacked && notPacked.length > 0) {
      // Fetch product and order details for better error messages (use LEFT JOIN logic via separate queries)
      const productIds = Array.from(new Set(notPacked.map(p => p.product_id)));
      const orderIds = Array.from(new Set(notPacked.map(p => p.order_id)));

      const [productsResult, ordersResult] = await Promise.all([
        supabaseAdmin.from('products').select('id, name, sku').in('id', productIds),
        supabaseAdmin.from('orders').select('id, shopify_order_number').in('id', orderIds)
      ]);

      const productMap = new Map((productsResult.data || []).map(p => [p.id, p]));
      const orderMap = new Map((ordersResult.data || []).map(o => [o.id, o]));

      // Build detailed error message
      const itemsList = notPacked.slice(0, 5).map((p: any) => {
        const product = productMap.get(p.product_id);
        const order = orderMap.get(p.order_id);
        const productName = product?.name || 'Producto desconocido (puede haber sido eliminado)';
        const sku = product?.sku || 'N/A';
        const orderNumber = order?.shopify_order_number || p.order_id?.slice(0, 8) || 'UNKNOWN';
        return `• ${productName} (SKU: ${sku}) - Pedido: ${orderNumber} - Empacado: ${p.quantity_packed}/${p.quantity_needed}`;
      }).join('\n');

      const moreItems = notPacked.length > 5 ? `\n... y ${notPacked.length - 5} items más` : '';

      // Log for debugging
      logger.warn('WAREHOUSE', `Session ${sessionId} has ${notPacked.length} unpacked items:`, notPacked);

      throw new Error(
        `⚠️ No se puede completar la sesión\n\n` +
        `Hay ${notPacked.length} item(s) pendientes de empacar:\n\n` +
        `${itemsList}${moreItems}\n\n` +
        `💡 Asegúrate de empacar todos los productos antes de finalizar.`
      );
    }

    // Use atomic RPC function to complete session
    // This ensures all operations (order updates + session update) happen in a single transaction
    // with row-level locking to prevent race conditions
    const { data: rpcResult, error: rpcError } = await supabaseAdmin
      .rpc('complete_warehouse_session', {
        p_session_id: sessionId,
        p_store_id: storeId
      });

    if (rpcError) {

      // Fallback to non-transactional approach if RPC not available (migration not run yet)
      if (rpcError.message?.includes('function') || rpcError.code === '42883') {
        // Get all orders in this session
        const { data: sessionOrders, error: ordersError } = await supabaseAdmin
          .from('picking_session_orders')
          .select('order_id')
          .eq('picking_session_id', sessionId);

        if (ordersError) throw ordersError;

        const orderIds = sessionOrders?.map(so => so.order_id) || [];

        // Update all orders to ready_to_ship
        // SECURITY FIX: Add store_id filter to prevent cross-store updates
        // BATCH FIX: Use batched update for large order sets
        if (orderIds.length > 0) {
          let totalUpdated = 0;
          for (let i = 0; i < orderIds.length; i += IN_BATCH_SIZE) {
            const batch = orderIds.slice(i, i + IN_BATCH_SIZE);
            const { data: updatedOrders, error: orderUpdateError } = await supabaseAdmin
              .from('orders')
              .update({
                sleeves_status: 'ready_to_ship',
                updated_at: new Date().toISOString()
              })
              .eq('store_id', storeId)  // CRITICAL: Ensure orders belong to this store
              .in('id', batch)
              .eq('sleeves_status', 'in_preparation')
              .select('id');

            if (orderUpdateError) {
              throw new Error('Error al actualizar estado de pedidos');
            }
            totalUpdated += updatedOrders?.length || 0;
          }

          // Validate all orders were updated (security check)
          if (totalUpdated !== orderIds.length) {
            console.warn(`[completeSession] Expected ${orderIds.length} orders, updated ${totalUpdated}. Some orders may belong to different store.`);
          }
        }

        // Update session status
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('picking_sessions')
          .update({
            status: 'completed',
            packing_completed_at: new Date().toISOString(),
            completed_at: new Date().toISOString()
          })
          .eq('id', sessionId)
          .select()
          .single();

        if (updateError) throw updateError;
        return updated;
      }

      throw new Error(`Error al completar sesión: ${rpcError.message}`);
    }


    // Fetch updated session data
    const { data: updated, error: fetchError } = await supabaseAdmin
      .from('picking_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (fetchError) throw fetchError;

    return updated;
  } catch (error) {
    throw error;
  }
}

/**
 * Auto-pack all items for all orders in a session
 * This dramatically reduces warehouse operation time from O(n*m) clicks to O(1)
 * Used by the "Empacar Todo" button in the warehouse UI
 */
export async function autoPackSession(
  sessionId: string,
  storeId: string
): Promise<{
  success: boolean;
  session_id: string;
  orders_packed: number;
  items_packed: number;
  total_units: number;
  packed_at: string;
}> {
  try {
    // Call the atomic RPC function
    const { data, error } = await supabaseAdmin
      .rpc('auto_pack_session', {
        p_session_id: sessionId,
        p_store_id: storeId
      });

    if (error) {
      // Fallback implementation if RPC not available (migration not run)
      if (error.message?.includes('function') || error.code === '42883') {
        logger.warn('WAREHOUSE', 'auto_pack_session RPC not available, using fallback');
        return await autoPackSessionFallback(sessionId, storeId);
      }
      throw error;
    }

    return data;
  } catch (error) {
    logger.error('WAREHOUSE', 'Error in autoPackSession:', error);
    throw error;
  }
}

/**
 * Fallback implementation for autoPackSession when RPC is not available
 */
async function autoPackSessionFallback(
  sessionId: string,
  storeId: string
): Promise<{
  success: boolean;
  session_id: string;
  orders_packed: number;
  items_packed: number;
  total_units: number;
  packed_at: string;
}> {
  // 1. Validate session exists and is in packing status
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('picking_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('store_id', storeId)
    .single();

  if (sessionError || !session) {
    throw new Error('Session not found or access denied');
  }

  if (session.status !== 'packing') {
    throw new Error(`Session must be in packing status. Current status: ${session.status}`);
  }

  // 2. Fetch all unpacked items
  const { data: unpackedItems, error: fetchError } = await supabaseAdmin
    .from('packing_progress')
    .select('*')
    .eq('picking_session_id', sessionId);

  if (fetchError) throw fetchError;

  // N+1 FIX: Calculate items to update and use batch update
  const itemsToUpdate = (unpackedItems || []).filter(
    item => item.quantity_packed < item.quantity_needed
  );

  let itemsUpdated = 0;
  let unitsUpdated = 0;
  const orderIds = new Set<string>();

  if (itemsToUpdate.length > 0) {
    // Collect stats before batch update
    itemsToUpdate.forEach(item => {
      itemsUpdated++;
      unitsUpdated += item.quantity_needed;
      orderIds.add(item.order_id);
    });

    // CONCURRENCY FIX: Process batches SEQUENTIALLY to limit max DB connections
    // Each batch runs updates in parallel (max 50), but batches run one after another
    // This prevents overwhelming the database with 500+ simultaneous connections
    const BATCH_SIZE = 50;

    for (let i = 0; i < itemsToUpdate.length; i += BATCH_SIZE) {
      const batchItems = itemsToUpdate.slice(i, i + BATCH_SIZE);
      const timestamp = new Date().toISOString();

      // Execute updates within this batch in parallel (max 50 concurrent)
      await Promise.all(
        batchItems.map(item =>
          supabaseAdmin
            .from('packing_progress')
            .update({
              quantity_packed: item.quantity_needed,
              updated_at: timestamp
            })
            .eq('id', item.id)
        )
      );
    }
  }

  // 4. Update session activity
  await supabaseAdmin
    .from('picking_sessions')
    .update({
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  return {
    success: true,
    session_id: sessionId,
    orders_packed: orderIds.size,
    items_packed: itemsUpdated,
    total_units: unitsUpdated,
    packed_at: new Date().toISOString()
  };
}

/**
 * Pack all items for a single order in one call
 * Useful for the "Empacar" button on individual order cards
 */
export async function packAllItemsForOrder(
  sessionId: string,
  orderId: string,
  storeId: string
): Promise<{
  success: boolean;
  session_id: string;
  order_id: string;
  items_packed: number;
  total_units: number;
  is_complete: boolean;
  packed_at: string;
}> {
  try {
    // Call the atomic RPC function
    const { data, error } = await supabaseAdmin
      .rpc('pack_all_items_for_order', {
        p_session_id: sessionId,
        p_order_id: orderId,
        p_store_id: storeId
      });

    if (error) {
      // Fallback implementation if RPC not available
      if (error.message?.includes('function') || error.code === '42883') {
        logger.warn('WAREHOUSE', 'pack_all_items_for_order RPC not available, using fallback');
        return await packAllItemsForOrderFallback(sessionId, orderId, storeId);
      }
      throw error;
    }

    return data;
  } catch (error) {
    logger.error('WAREHOUSE', 'Error in packAllItemsForOrder:', error);
    throw error;
  }
}

/**
 * Fallback implementation for packAllItemsForOrder when RPC is not available
 */
async function packAllItemsForOrderFallback(
  sessionId: string,
  orderId: string,
  storeId: string
): Promise<{
  success: boolean;
  session_id: string;
  order_id: string;
  items_packed: number;
  total_units: number;
  is_complete: boolean;
  packed_at: string;
}> {
  // 1. Validate session
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('picking_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('store_id', storeId)
    .single();

  if (sessionError || !session) {
    throw new Error('Session not found or access denied');
  }

  if (session.status !== 'packing') {
    throw new Error(`Session must be in packing status. Current status: ${session.status}`);
  }

  // 2. Validate order is in session and can be packed
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, sleeves_status')
    .eq('id', orderId)
    .eq('store_id', storeId)
    .single();

  if (orderError || !order) {
    throw new Error('Order not found');
  }

  const blockedStatuses = ['ready_to_ship', 'shipped', 'in_transit', 'delivered', 'cancelled', 'rejected', 'returned'];
  if (blockedStatuses.includes(order.sleeves_status)) {
    throw new Error(`Cannot pack order with status: ${order.sleeves_status}`);
  }

  // 3. Verify order is in session
  const { data: sessionOrder, error: soError } = await supabaseAdmin
    .from('picking_session_orders')
    .select('order_id')
    .eq('picking_session_id', sessionId)
    .eq('order_id', orderId)
    .single();

  if (soError || !sessionOrder) {
    throw new Error('Order not found in this session');
  }

  // 4. Get unpacked items for this order
  const { data: unpackedItems, error: itemsError } = await supabaseAdmin
    .from('packing_progress')
    .select('*')
    .eq('picking_session_id', sessionId)
    .eq('order_id', orderId);

  if (itemsError) throw itemsError;

  // N+1 FIX: Filter items that need updating and use parallel batch updates
  const itemsToUpdate = (unpackedItems || []).filter(
    item => item.quantity_packed < item.quantity_needed
  );

  let itemsUpdated = 0;
  let unitsUpdated = 0;

  if (itemsToUpdate.length > 0) {
    // Calculate stats
    itemsToUpdate.forEach(item => {
      itemsUpdated++;
      unitsUpdated += (item.quantity_needed - item.quantity_packed);
    });

    // N+1 FIX: Execute all updates in parallel (order packing usually has <20 items)
    await Promise.all(
      itemsToUpdate.map(item =>
        supabaseAdmin
          .from('packing_progress')
          .update({
            quantity_packed: item.quantity_needed,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id)
      )
    );
  }

  // 6. Update session activity
  await supabaseAdmin
    .from('picking_sessions')
    .update({
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  return {
    success: true,
    session_id: sessionId,
    order_id: orderId,
    items_packed: itemsUpdated,
    total_units: unitsUpdated,
    is_complete: true,
    packed_at: new Date().toISOString()
  };
}

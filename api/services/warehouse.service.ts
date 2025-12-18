/**
 * Warehouse Service
 * Manages picking and packing workflow for confirmed orders
 * Optimized for manual input without barcode scanners
 */

import { supabaseAdmin } from '../db/connection';

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
  total_quantity_needed: number;
  quantity_picked: number;
  created_at: string;
  updated_at: string;
  product_name?: string;
  product_image?: string;
  product_sku?: string;
  shelf_location?: string;
}

export interface PackingProgress {
  id: string;
  picking_session_id: string;
  order_id: string;
  product_id: string;
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
  items: Array<{
    product_id: string;
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
    console.log('📋 Creating picking session with order IDs:', orderIds);
    console.log('   Store ID:', storeId);
    console.log('   User ID:', userId);

    // Validate that all order IDs are UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = orderIds.filter(id => !uuidRegex.test(id));

    if (invalidIds.length > 0) {
      console.error('❌ Invalid order IDs detected (not UUIDs):',  invalidIds);
      throw new Error(
        `Invalid order IDs: ${invalidIds.join(', ')}. ` +
        `Expected UUIDs but received non-UUID values. ` +
        `This might indicate that Shopify order IDs are being used instead of internal UUIDs.`
      );
    }

    // 1. Validate that all orders exist and are confirmed
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, sleeves_status')
      .eq('store_id', storeId)
      .in('id', orderIds);

    if (ordersError) throw ordersError;
    if (!orders || orders.length === 0) {
      throw new Error('No valid orders found');
    }

    const nonConfirmedOrders = orders.filter((o: any) => o.sleeves_status !== 'confirmed');
    if (nonConfirmedOrders.length > 0) {
      throw new Error('All orders must be in confirmed status');
    }

    // 2. Generate unique session code
    const { data: codeData, error: codeError } = await supabaseAdmin
      .rpc('generate_session_code');

    if (codeError) throw codeError;
    const sessionCode = codeData;

    // 3. Create picking session
    const { data: session, error: sessionError } = await supabaseAdmin
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

    // 4. Link orders to session
    const sessionOrders = orderIds.map(orderId => ({
      picking_session_id: session.id,
      order_id: orderId
    }));

    const { error: linkError } = await supabaseAdmin
      .from('picking_session_orders')
      .insert(sessionOrders);

    if (linkError) throw linkError;

    // 5. Update orders status to in_preparation
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ sleeves_status: 'in_preparation' })
      .in('id', orderIds);

    if (updateError) throw updateError;

    // 6. Fetch line items from normalized table (order_line_items)
    // This table has proper product_id mapping (Shopify ID -> Local UUID)
    const { data: lineItems, error: itemsError } = await supabaseAdmin
      .from('order_line_items')
      .select('order_id, product_id, quantity, shopify_product_id, shopify_variant_id, product_name')
      .in('order_id', orderIds);

    if (itemsError) throw itemsError;

    // Check if any line items are missing product_id mapping
    const unmappedItems = lineItems?.filter(item => !item.product_id) || [];
    if (unmappedItems.length > 0) {
      console.warn('⚠️  WARNING: Some line items do not have product_id mapped:');
      unmappedItems.forEach(item => {
        console.warn(`   - ${item.product_name} (Shopify: ${item.shopify_product_id})`);
      });

      // Create a user-friendly list of missing products
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

    // Aggregate quantities by product from order_line_items
    const productQuantities = new Map<string, number>();
    lineItems?.forEach(item => {
      const productId = item.product_id;
      const quantity = parseInt(item.quantity) || 0;
      if (productId) {
        const currentQty = productQuantities.get(productId) || 0;
        productQuantities.set(productId, currentQty + quantity);
      }
    });

    // Validate all product IDs are UUIDs (reuse uuidRegex from line 81)
    const invalidProductIds = Array.from(productQuantities.keys()).filter(id => !uuidRegex.test(id));

    if (invalidProductIds.length > 0) {
      console.error('❌ Invalid product IDs in line items (not UUIDs):', invalidProductIds);
      throw new Error(
        `Invalid product IDs detected: ${invalidProductIds.join(', ')}. ` +
        `Product IDs must be UUIDs. Check the order_line_items table for data corruption.`
      );
    }

    // Insert aggregated picking list
    const pickingItems = Array.from(productQuantities.entries()).map(([productId, quantity]) => ({
      picking_session_id: session.id,
      product_id: productId,
      total_quantity_needed: quantity,
      quantity_picked: 0
    }));

    if (pickingItems.length === 0) {
      throw new Error('No valid products found in the selected orders');
    }

    const { error: pickingItemsError } = await supabaseAdmin
      .from('picking_session_items')
      .insert(pickingItems);

    if (pickingItemsError) throw pickingItemsError;

    return session;
  } catch (error) {
    console.error('Error creating picking session:', error);
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
      throw new Error('Session not found');
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
    const productIds = items?.map(item => item.product_id) || [];
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id, name, image_url, sku')
      .in('id', productIds);

    if (productsError) throw productsError;

    // Create product map for quick lookup
    const productMap = new Map(products?.map(p => [p.id, p]) || []);

    // Format items
    const formattedItems = (items || []).map(item => {
      const product = productMap.get(item.product_id);
      return {
        ...item,
        product_name: product?.name || 'Producto desconocido',
        product_image: product?.image_url,
        product_sku: product?.sku,
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
    console.error('Error getting picking list:', error);
    throw error;
  }
}

/**
 * Updates picking progress for a specific product
 */
export async function updatePickingProgress(
  sessionId: string,
  productId: string,
  quantityPicked: number,
  storeId: string
): Promise<PickingSessionItem> {
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

    // Get current item
    const { data: item, error: itemError } = await supabaseAdmin
      .from('picking_session_items')
      .select('*')
      .eq('picking_session_id', sessionId)
      .eq('product_id', productId)
      .single();

    if (itemError) throw itemError;

    // Validate quantity
    if (quantityPicked < 0 || quantityPicked > item.total_quantity_needed) {
      throw new Error(`Invalid quantity. Must be between 0 and ${item.total_quantity_needed}`);
    }

    // Update quantity
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('picking_session_items')
      .update({ quantity_picked: quantityPicked })
      .eq('picking_session_id', sessionId)
      .eq('product_id', productId)
      .select()
      .single();

    if (updateError) throw updateError;

    return updated;
  } catch (error) {
    console.error('Error updating picking progress:', error);
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

    // Verify all items are picked
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('picking_session_items')
      .select('product_id, total_quantity_needed, quantity_picked')
      .eq('picking_session_id', sessionId);

    if (itemsError) throw itemsError;

    const unpickedItems = items?.filter(
      item => item.quantity_picked < item.total_quantity_needed
    );

    if (unpickedItems && unpickedItems.length > 0) {
      throw new Error('All items must be picked before finishing');
    }

    // Deduct stock for picked items
    console.log('📦 Deducting stock for picked items...');
    for (const item of items || []) {
      // Get current stock
      const { data: product, error: fetchError } = await supabaseAdmin
        .from('products')
        .select('stock')
        .eq('id', item.product_id)
        .single();

      if (fetchError) {
        console.error(`❌ Error fetching stock for product ${item.product_id}:`, fetchError);
        continue;
      }

      // Calculate new stock (ensure it doesn't go below 0)
      const currentStock = product?.stock || 0;
      const newStock = Math.max(0, currentStock - item.quantity_picked);

      // Update stock
      const { error: stockError } = await supabaseAdmin
        .from('products')
        .update({ stock: newStock })
        .eq('id', item.product_id);

      if (stockError) {
        console.error(`❌ Error updating stock for product ${item.product_id}:`, stockError);
      } else {
        console.log(`✅ Stock updated for product ${item.product_id}: ${currentStock} → ${newStock} (-${item.quantity_picked})`);
      }
    }

    // Initialize packing progress for each order item
    // First get the order IDs from the session
    const { data: sessionOrders, error: sessionOrdersError } = await supabaseAdmin
      .from('picking_session_orders')
      .select('order_id')
      .eq('picking_session_id', sessionId);

    if (sessionOrdersError) throw sessionOrdersError;

    const orderIdsInSession = sessionOrders?.map(so => so.order_id) || [];

    // Now get the orders with their line_items
    const { data: ordersWithItems, error: orderItemsError } = await supabaseAdmin
      .from('orders')
      .select('id, line_items')
      .in('id', orderIdsInSession);

    if (orderItemsError) throw orderItemsError;

    // Extract and flatten order items from JSONB line_items
    const packingRecords: Array<{
      picking_session_id: string;
      order_id: string;
      product_id: string;
      quantity_needed: number;
      quantity_packed: number;
    }> = [];

    ordersWithItems?.forEach(order => {
      if (Array.isArray(order.line_items)) {
        order.line_items.forEach((item: any) => {
          const productId = item.product_id;
          const quantity = parseInt(item.quantity) || 0;
          if (productId) {
            packingRecords.push({
              picking_session_id: sessionId,
              order_id: order.id,
              product_id: productId,
              quantity_needed: quantity,
              quantity_packed: 0
            });
          }
        });
      }
    });

    if (packingRecords.length > 0) {
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
    console.error('Error finishing picking:', error);
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
          customer_first_name,
          customer_last_name,
          customer_phone,
          customer_address,
          address_reference,
          neighborhood,
          delivery_notes,
          delivery_link_token,
          courier_id,
          cod_amount,
          payment_method,
          printed,
          printed_at
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
    const orderIds = sessionOrders?.map((so: any) => so.orders.id) || [];
    const { data: carriersData } = await supabaseAdmin
      .from('carriers')
      .select('id, name');

    const carrierMap = new Map(carriersData?.map(c => [c.id, c.name]) || []);

    // Format orders with their items
    const orders: OrderForPacking[] = sessionOrders?.map((so: any) => {
      const order = so.orders;
      const orderProgress = packingProgress?.filter(p => p.order_id === order.id) || [];

      const items = orderProgress.map((p: any) => ({
        product_id: p.product_id,
        product_name: p.products?.name || '',
        product_image: p.products?.image_url || '',
        quantity_needed: p.quantity_needed,
        quantity_packed: p.quantity_packed
      }));

      const is_complete = items.every(item => item.quantity_packed >= item.quantity_needed);

      return {
        id: order.id,
        order_number: order.shopify_order_number || `ORD-${order.id.slice(0, 8)}`,
        customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
        customer_phone: order.customer_phone,
        customer_address: order.customer_address,
        address_reference: order.address_reference,
        neighborhood: order.neighborhood,
        delivery_notes: order.delivery_notes,
        delivery_link_token: order.delivery_link_token,
        carrier_id: order.courier_id,
        carrier_name: order.courier_id ? carrierMap.get(order.courier_id) : undefined,
        cod_amount: order.cod_amount,
        payment_method: order.payment_method,
        printed: order.printed,
        printed_at: order.printed_at,
        items,
        is_complete
      };
    }) || [];

    // Get available items (basket)
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

    // Calculate total packed per product
    const packedByProduct = new Map<string, number>();
    packingProgress?.forEach(p => {
      const current = packedByProduct.get(p.product_id) || 0;
      packedByProduct.set(p.product_id, current + p.quantity_packed);
    });

    const availableItems = pickedItems?.map(item => ({
      product_id: item.product_id,
      product_name: item.products?.name || '',
      product_image: item.products?.image_url || '',
      total_picked: item.quantity_picked,
      total_packed: packedByProduct.get(item.product_id) || 0,
      remaining: item.quantity_picked - (packedByProduct.get(item.product_id) || 0)
    })) || [];

    return {
      session,
      orders,
      availableItems
    };
  } catch (error) {
    console.error('Error getting packing list:', error);
    throw error;
  }
}

/**
 * Assigns one unit of a product to an order (packing)
 */
export async function updatePackingProgress(
  sessionId: string,
  orderId: string,
  productId: string,
  storeId: string
): Promise<PackingProgress> {
  try {
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
    // If order already reached ready_to_ship, stock was decremented and packing is locked
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('sleeves_status')
      .eq('id', orderId)
      .single();

    if (orderError) throw orderError;
    if (order.sleeves_status === 'ready_to_ship' ||
        order.sleeves_status === 'shipped' ||
        order.sleeves_status === 'delivered') {
      throw new Error(
        'Cannot modify packing - order has already been completed and stock was decremented. ' +
        'This order is now locked to maintain inventory accuracy.'
      );
    }

    // Get current packing progress
    const { data: progress, error: progressError } = await supabaseAdmin
      .from('packing_progress')
      .select('*')
      .eq('picking_session_id', sessionId)
      .eq('order_id', orderId)
      .eq('product_id', productId)
      .single();

    if (progressError) throw progressError;

    // Check if already fully packed
    if (progress.quantity_packed >= progress.quantity_needed) {
      throw new Error('This item is already fully packed for this order');
    }

    // Check if item is available in basket
    const { data: pickedItem, error: pickedError } = await supabaseAdmin
      .from('picking_session_items')
      .select('quantity_picked')
      .eq('picking_session_id', sessionId)
      .eq('product_id', productId)
      .single();

    if (pickedError) throw pickedError;

    // Get total packed across all orders
    const { data: allPacked, error: allPackedError } = await supabaseAdmin
      .from('packing_progress')
      .select('quantity_packed')
      .eq('picking_session_id', sessionId)
      .eq('product_id', productId);

    if (allPackedError) throw allPackedError;

    const totalPacked = allPacked?.reduce((sum, p) => sum + p.quantity_packed, 0) || 0;

    if (totalPacked >= pickedItem.quantity_picked) {
      throw new Error('No more units of this item available to pack');
    }

    // Increment quantity packed
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('packing_progress')
      .update({ quantity_packed: progress.quantity_packed + 1 })
      .eq('picking_session_id', sessionId)
      .eq('order_id', orderId)
      .eq('product_id', productId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Note: We no longer automatically change to ready_to_ship when packing is complete
    // The order will remain in 'in_preparation' until the shipping label is printed
    // This ensures stock is only decremented when the order is truly ready to ship

    return updated;
  } catch (error) {
    console.error('Error updating packing progress:', error);
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

    return data || [];
  } catch (error) {
    console.error('Error getting active sessions:', error);
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
        carriers!courier_id (name)
      `)
      .eq('store_id', storeId)
      .eq('sleeves_status', 'confirmed')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate total_items from JSONB line_items and format customer name
    const ordersWithCounts = (data || []).map((order: any) => {
      // Validate that id is a UUID (not a Shopify ID)
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.id);

      if (!isValidUUID) {
        console.error(`❌ Invalid order ID format (expected UUID, got ${order.id}). This order has corrupted data.`);
        console.error(`   Shopify Order ID: ${order.shopify_order_id}`);
        console.error(`   Order Number: ${order.shopify_order_number}`);
      }

      return {
        id: order.id,
        order_number: order.shopify_order_number || `ORD-${order.id.slice(0, 8)}`,
        customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
        customer_phone: order.customer_phone,
        created_at: order.created_at,
        carrier_name: order.carriers?.name || 'Sin transportadora',
        total_items: Array.isArray(order.line_items)
          ? order.line_items.reduce((sum: number, item: any) => sum + (parseInt(item.quantity) || 0), 0)
          : 0
      };
    });

    return ordersWithCounts;
  } catch (error) {
    console.error('Error getting confirmed orders:', error);
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

    // Get all packing progress for this session
    const { data: packingProgress, error: progressError } = await supabaseAdmin
      .from('packing_progress')
      .select('*')
      .eq('picking_session_id', sessionId);

    if (progressError) throw progressError;

    // Verify all items are fully packed
    const notPacked = packingProgress?.filter(
      p => p.quantity_packed < p.quantity_needed
    );

    if (notPacked && notPacked.length > 0) {
      throw new Error('All orders must be packed before completing session');
    }

    // Get all orders in this session
    const { data: sessionOrders, error: ordersError } = await supabaseAdmin
      .from('picking_session_orders')
      .select('order_id')
      .eq('picking_session_id', sessionId);

    if (ordersError) throw ordersError;

    const orderIds = sessionOrders?.map(so => so.order_id) || [];

    // Update all orders to ready_to_ship
    // This triggers the automatic stock decrement via trigger_update_stock_on_order_status
    if (orderIds.length > 0) {
      const { error: orderUpdateError } = await supabaseAdmin
        .from('orders')
        .update({
          sleeves_status: 'ready_to_ship',
          updated_at: new Date().toISOString()
        })
        .in('id', orderIds)
        .eq('sleeves_status', 'in_preparation'); // Only update orders still in_preparation

      if (orderUpdateError) {
        console.error('Error updating orders to ready_to_ship:', orderUpdateError);
        throw new Error('Failed to update orders status');
      }

      console.log(`✅ Updated ${orderIds.length} orders to ready_to_ship (stock will be automatically decremented)`);
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
  } catch (error) {
    console.error('Error completing session:', error);
    throw error;
  }
}

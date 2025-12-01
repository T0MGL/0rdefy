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
    // 1. Validate that all orders exist and are confirmed
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, status')
      .eq('store_id', storeId)
      .in('id', orderIds);

    if (ordersError) throw ordersError;
    if (!orders || orders.length === 0) {
      throw new Error('No valid orders found');
    }

    const nonConfirmedOrders = orders.filter(o => o.status !== 'confirmed');
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
      .update({ status: 'in_preparation' })
      .in('id', orderIds);

    if (updateError) throw updateError;

    // 6. Fetch orders with line_items to aggregate for picking list
    const { data: ordersWithItems, error: itemsError } = await supabaseAdmin
      .from('orders')
      .select('id, line_items')
      .in('id', orderIds);

    if (itemsError) throw itemsError;

    // Aggregate quantities by product from JSONB line_items
    const productQuantities = new Map<string, number>();
    ordersWithItems?.forEach(order => {
      if (Array.isArray(order.line_items)) {
        order.line_items.forEach((item: any) => {
          const productId = item.product_id;
          const quantity = parseInt(item.quantity) || 0;
          if (productId) {
            const currentQty = productQuantities.get(productId) || 0;
            productQuantities.set(productId, currentQty + quantity);
          }
        });
      }
    });

    // Insert aggregated picking list
    const pickingItems = Array.from(productQuantities.entries()).map(([productId, quantity]) => ({
      picking_session_id: session.id,
      product_id: productId,
      total_quantity_needed: quantity,
      quantity_picked: 0
    }));

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
): Promise<PickingSessionItem[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('picking_session_items')
      .select(`
        *,
        products:product_id (
          name,
          image_url,
          sku,
          shelf_location
        )
      `)
      .eq('picking_session_id', sessionId);

    if (error) throw error;

    // Verify session belongs to store
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('picking_sessions')
      .select('store_id')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (session.store_id !== storeId) {
      throw new Error('Session does not belong to this store');
    }

    // Format response
    return data.map(item => ({
      ...item,
      product_name: item.products?.name,
      product_image: item.products?.image_url,
      product_sku: item.products?.sku,
      shelf_location: item.products?.shelf_location
    }));
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
      .select('total_quantity_needed, quantity_picked')
      .eq('picking_session_id', sessionId);

    if (itemsError) throw itemsError;

    const unpickedItems = items?.filter(
      item => item.quantity_picked < item.total_quantity_needed
    );

    if (unpickedItems && unpickedItems.length > 0) {
      throw new Error('All items must be picked before finishing');
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

    // Get orders in session
    const { data: sessionOrders, error: ordersError } = await supabaseAdmin
      .from('picking_session_orders')
      .select(`
        order_id,
        orders (
          id,
          order_number,
          customer_name,
          customer_phone
        )
      `)
      .eq('picking_session_id', sessionId);

    if (ordersError) throw ordersError;

    // Get packing progress
    const { data: packingProgress, error: progressError } = await supabaseAdmin
      .from('packing_progress')
      .select(`
        *,
        products:product_id (
          name,
          image_url
        )
      `)
      .eq('picking_session_id', sessionId);

    if (progressError) throw progressError;

    // Format orders with their items
    const orders: OrderForPacking[] = sessionOrders?.map(so => {
      const order = so.orders;
      const orderProgress = packingProgress?.filter(p => p.order_id === order.id) || [];

      const items = orderProgress.map(p => ({
        product_id: p.product_id,
        product_name: p.products?.name || '',
        product_image: p.products?.image_url || '',
        quantity_needed: p.quantity_needed,
        quantity_packed: p.quantity_packed
      }));

      const is_complete = items.every(item => item.quantity_packed >= item.quantity_needed);

      return {
        id: order.id,
        order_number: order.order_number,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        items,
        is_complete
      };
    }) || [];

    // Get available items (basket)
    const { data: pickedItems, error: pickedError } = await supabaseAdmin
      .from('picking_session_items')
      .select(`
        *,
        products:product_id (
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

    // Check if order is now complete
    const { data: orderProgress, error: orderProgressError } = await supabaseAdmin
      .from('packing_progress')
      .select('quantity_needed, quantity_packed')
      .eq('picking_session_id', sessionId)
      .eq('order_id', orderId);

    if (orderProgressError) throw orderProgressError;

    const orderComplete = orderProgress?.every(p => p.quantity_packed >= p.quantity_needed);

    if (orderComplete) {
      // Update order status to ready_to_ship
      await supabaseAdmin
        .from('orders')
        .update({ status: 'ready_to_ship' })
        .eq('id', orderId);
    }

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
        order_number,
        customer_name,
        customer_phone,
        created_at,
        line_items,
        carrier:carrier_id (name)
      `)
      .eq('store_id', storeId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate total_items from JSONB line_items
    const ordersWithCounts = (data || []).map(order => ({
      ...order,
      total_items: Array.isArray(order.line_items) ? order.line_items.length : 0,
      line_items: undefined // Remove from response
    }));

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

    // Verify all orders are ready_to_ship
    const { data: sessionOrders, error: ordersError } = await supabaseAdmin
      .from('picking_session_orders')
      .select('order_id, orders!inner(status)')
      .eq('picking_session_id', sessionId);

    if (ordersError) throw ordersError;

    const notReady = sessionOrders?.filter(
      so => so.orders.status !== 'ready_to_ship'
    );

    if (notReady && notReady.length > 0) {
      throw new Error('All orders must be packed before completing session');
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

/**
 * Returns Service
 * Handles return/refund processing with batch sessions and inventory integration
 *
 * @author Bright Idea
 * @date 2025-12-02
 */

import { supabaseAdmin } from '../db/connection.js';

export interface ReturnSession {
  id: string;
  store_id: string;
  session_code: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  total_orders: number;
  processed_orders: number;
  total_items: number;
  accepted_items: number;
  rejected_items: number;
  notes?: string;
  created_at: string;
  completed_at?: string;
  created_by: string;
}

export interface ReturnSessionOrder {
  id: string;
  session_id: string;
  order_id: string;
  original_status: string;
  processed: boolean;
  processed_at?: string;
}

export interface ReturnSessionItem {
  id: string;
  session_id: string;
  order_id: string;
  product_id: string;
  quantity_expected: number;
  quantity_received: number;
  quantity_accepted: number;
  quantity_rejected: number;
  rejection_reason?: 'damaged' | 'defective' | 'incomplete' | 'wrong_item' | 'other';
  rejection_notes?: string;
  unit_cost: number;
  created_at: string;
  processed_at?: string;
  // Joined data
  product?: any;
  order?: any;
}

export interface EligibleOrder {
  id: string;
  order_number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  total_price: number;
  items_count: number;
  delivered_at?: string;
  shipped_at?: string;
}

/**
 * Get eligible orders for return (delivered, shipped, cancelled)
 */
export async function getEligibleOrders(storeId: string): Promise<EligibleOrder[]> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(`
      id,
      shopify_order_number,
      sleeves_status,
      customer_first_name,
      customer_last_name,
      customer_phone,
      total_price,
      line_items,
      delivered_at,
      in_transit_at,
      created_at,
      delivery_status
    `)
    .eq('store_id', storeId)
    .or('sleeves_status.in.(delivered,shipped,cancelled),delivery_status.eq.failed')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching eligible orders:', error);
    throw new Error(`Failed to fetch eligible orders: ${error.message}`);
  }

  return data.map(order => ({
    id: order.id,
    order_number: order.shopify_order_number || `ORD-${order.id.slice(0, 8)}`,
    status: order.delivery_status === 'failed' ? 'failed' : order.sleeves_status,
    customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Sin nombre',
    customer_phone: order.customer_phone,
    total_price: order.total_price,
    items_count: order.line_items?.length || 0,
    delivered_at: order.delivered_at,
    shipped_at: order.in_transit_at,
  }));
}

/**
 * Create a new return session
 */
export async function createReturnSession(
  storeId: string,
  orderIds: string[],
  userId: string,
  notes?: string
): Promise<ReturnSession> {
  // Generate session code
  const { data: codeData, error: codeError } = await supabaseAdmin
    .rpc('generate_return_session_code', { p_store_id: storeId });

  if (codeError) {
    console.error('Error generating session code:', codeError);
    throw new Error(`Failed to generate session code: ${codeError.message}`);
  }

  const sessionCode = codeData;

  // Get order details
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select('id, sleeves_status, line_items')
    .eq('store_id', storeId)
    .in('id', orderIds);

  if (ordersError) {
    console.error('Error fetching orders:', ordersError);
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }

  // Calculate total items
  const totalItems = orders.reduce((sum, order) => {
    return sum + (order.line_items?.length || 0);
  }, 0);

  // Create session
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('return_sessions')
    .insert({
      store_id: storeId,
      session_code: sessionCode,
      status: 'in_progress',
      total_orders: orderIds.length,
      total_items: totalItems,
      notes,
      created_by: userId,
    })
    .select()
    .single();

  if (sessionError) {
    console.error('Error creating session:', sessionError);
    throw new Error(`Failed to create session: ${sessionError.message}`);
  }

  // Link orders to session
  const sessionOrders = orders.map(order => ({
    session_id: session.id,
    order_id: order.id,
    original_status: order.sleeves_status,
  }));

  const { error: ordersLinkError } = await supabaseAdmin
    .from('return_session_orders')
    .insert(sessionOrders);

  if (ordersLinkError) {
    console.error('Error linking orders:', ordersLinkError);
    throw new Error(`Failed to link orders: ${ordersLinkError.message}`);
  }

  // Create items from order line_items
  const items = [];
  for (const order of orders) {
    if (order.line_items && Array.isArray(order.line_items)) {
      for (const lineItem of order.line_items) {
        items.push({
          session_id: session.id,
          order_id: order.id,
          product_id: lineItem.product_id,
          quantity_expected: lineItem.quantity,
          unit_cost: lineItem.unit_cost || 0,
        });
      }
    }
  }

  if (items.length > 0) {
    const { error: itemsError } = await supabaseAdmin
      .from('return_session_items')
      .insert(items);

    if (itemsError) {
      console.error('Error creating items:', itemsError);
      throw new Error(`Failed to create items: ${itemsError.message}`);
    }
  }

  return session;
}

/**
 * Get return session by ID with full details
 */
export async function getReturnSession(sessionId: string): Promise<any> {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('return_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sessionError) {
    console.error('Error fetching session:', sessionError);
    throw new Error(`Failed to fetch session: ${sessionError.message}`);
  }

  // Get session orders
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('return_session_orders')
    .select(`
      *,
      order:orders(*)
    `)
    .eq('session_id', sessionId);

  if (ordersError) {
    console.error('Error fetching session orders:', ordersError);
    throw new Error(`Failed to fetch session orders: ${ordersError.message}`);
  }

  // Get session items
  const { data: items, error: itemsError } = await supabaseAdmin
    .from('return_session_items')
    .select(`
      *,
      product:products(id, name, sku, image_url, stock)
    `)
    .eq('session_id', sessionId)
    .order('order_id');

  if (itemsError) {
    console.error('Error fetching session items:', itemsError);
    throw new Error(`Failed to fetch session items: ${itemsError.message}`);
  }

  return {
    ...session,
    orders,
    items,
  };
}

/**
 * Get all return sessions for a store
 */
export async function getReturnSessions(storeId: string): Promise<ReturnSession[]> {
  const { data, error } = await supabaseAdmin
    .from('return_sessions')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching sessions:', error);
    throw new Error(`Failed to fetch sessions: ${error.message}`);
  }

  return data;
}

/**
 * Update return session item (accept/reject quantities)
 */
export async function updateReturnItem(
  itemId: string,
  updates: {
    quantity_received?: number;
    quantity_accepted?: number;
    quantity_rejected?: number;
    rejection_reason?: string;
    rejection_notes?: string;
  }
): Promise<ReturnSessionItem> {
  const { data, error } = await supabaseAdmin
    .from('return_session_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();

  if (error) {
    console.error('Error updating item:', error);
    throw new Error(`Failed to update item: ${error.message}`);
  }

  return data;
}

/**
 * Complete return session (process inventory updates and order status changes)
 */
export async function completeReturnSession(sessionId: string): Promise<any> {
  const { data, error } = await supabaseAdmin
    .rpc('complete_return_session', { p_session_id: sessionId });

  if (error) {
    console.error('Error completing session:', error);
    throw new Error(`Failed to complete session: ${error.message}`);
  }

  return data;
}

/**
 * Cancel return session
 */
export async function cancelReturnSession(sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('return_sessions')
    .update({ status: 'cancelled' })
    .eq('id', sessionId);

  if (error) {
    console.error('Error cancelling session:', error);
    throw new Error(`Failed to cancel session: ${error.message}`);
  }
}

/**
 * Get return statistics for a store
 */
export async function getReturnStats(storeId: string): Promise<any> {
  const { data: sessions, error } = await supabaseAdmin
    .from('return_sessions')
    .select('*')
    .eq('store_id', storeId)
    .eq('status', 'completed');

  if (error) {
    console.error('Error fetching return stats:', error);
    throw new Error(`Failed to fetch return stats: ${error.message}`);
  }

  const totalSessions = sessions.length;
  const totalOrders = sessions.reduce((sum, s) => sum + s.processed_orders, 0);
  const totalAccepted = sessions.reduce((sum, s) => sum + s.accepted_items, 0);
  const totalRejected = sessions.reduce((sum, s) => sum + s.rejected_items, 0);

  return {
    total_sessions: totalSessions,
    total_orders: totalOrders,
    total_items_accepted: totalAccepted,
    total_items_rejected: totalRejected,
    acceptance_rate: totalAccepted + totalRejected > 0
      ? (totalAccepted / (totalAccepted + totalRejected) * 100).toFixed(1)
      : 0,
  };
}

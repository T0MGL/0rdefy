/**
 * Shipping Service
 * Manages the dispatch of orders to couriers
 * Handles the transition from ready_to_ship → shipped status
 */

import { supabaseAdmin } from '../db/connection';
import { generateDispatchExcel, DispatchOrder } from '../utils/excel-export';
import { isCodPayment } from '../utils/payment';

export interface Shipment {
  id: string;
  store_id: string;
  order_id: string;
  courier_id: string | null;
  shipped_at: string;
  shipped_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReadyToShipOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  carrier_name: string;
  carrier_id: string;
  total_items: number;
  cod_amount: number;
  created_at: string;
  // Shopify order identifiers
  shopify_order_name?: string;
  shopify_order_number?: string;
  shopify_order_id?: string;
}

export interface ShipmentResult {
  shipment_id: string | null;
  order_id: string;
  order_number: string;
  success: boolean;
  error_message: string | null;
}

/**
 * Gets all orders ready to ship for a store
 */
export async function getReadyToShipOrders(storeId: string): Promise<ReadyToShipOrder[]> {
  try {
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        shopify_order_name,
        shopify_order_number,
        shopify_order_id,
        customer_first_name,
        customer_last_name,
        customer_phone,
        customer_address,
        courier_id,
        cod_amount,
        line_items,
        created_at,
        carriers!courier_id (
          id,
          name
        )
      `)
      .eq('store_id', storeId)
      .eq('sleeves_status', 'ready_to_ship')
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Format response
    return (orders || []).map((order: any) => {
      // Determine display order number:
      // 1. Shopify order name (#1315 format) - preferred for Shopify orders
      // 2. Shopify order number (numeric) - fallback for Shopify
      // 3. Ordefy format (ORD-XXXXXXXX) - for manual orders
      let displayOrderNumber: string;
      if (order.shopify_order_name) {
        // Shopify order name already has # prefix (e.g., "#1315")
        displayOrderNumber = order.shopify_order_name;
      } else if (order.shopify_order_number) {
        // Add # prefix if only number is available
        displayOrderNumber = `#${order.shopify_order_number}`;
      } else {
        // Manual order - use Ordefy format
        displayOrderNumber = `ORD-${order.id.slice(0, 8).toUpperCase()}`;
      }

      return {
        id: order.id,
        order_number: displayOrderNumber,
        customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
        customer_phone: order.customer_phone || '',
        customer_address: order.customer_address || '',
        carrier_name: order.carriers?.name || 'Sin transportadora',
        carrier_id: order.courier_id,
        total_items: Array.isArray(order.line_items)
          ? order.line_items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0)
          : 0,
        cod_amount: order.cod_amount || 0,
        created_at: order.created_at,
        // Shopify order identifiers for display
        shopify_order_name: order.shopify_order_name || null,
        shopify_order_number: order.shopify_order_number || null,
        shopify_order_id: order.shopify_order_id || null
      };
    });
  } catch (error) {
    console.error('Error getting ready to ship orders:', error);
    throw error;
  }
}

/**
 * Creates a single shipment and updates order to shipped status
 */
export async function createShipment(
  storeId: string,
  orderId: string,
  userId: string,
  notes?: string
): Promise<Shipment> {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('create_shipment', {
        p_store_id: storeId,
        p_order_id: orderId,
        p_shipped_by: userId,
        p_notes: notes || null
      });

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error creating shipment:', error);
    throw error;
  }
}

/**
 * Creates multiple shipments at once (batch dispatch)
 */
export async function createShipmentsBatch(
  storeId: string,
  orderIds: string[],
  userId: string,
  notes?: string
): Promise<ShipmentResult[]> {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('create_shipments_batch', {
        p_store_id: storeId,
        p_order_ids: orderIds,
        p_shipped_by: userId,
        p_notes: notes || null
      });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error creating batch shipments:', error);
    throw error;
  }
}

/**
 * Gets shipment history for a specific order
 */
export async function getOrderShipments(
  orderId: string,
  storeId: string
): Promise<Shipment[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('shipments')
      .select('*')
      .eq('order_id', orderId)
      .eq('store_id', storeId)
      .order('shipped_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error getting order shipments:', error);
    throw error;
  }
}

/**
 * Gets all shipments for a store (with pagination)
 */
export async function getShipments(
  storeId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ shipments: Shipment[]; total: number }> {
  try {
    // Get total count
    const { count, error: countError } = await supabaseAdmin
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId);

    if (countError) throw countError;

    // Get shipments
    const { data, error } = await supabaseAdmin
      .from('shipments')
      .select('*')
      .eq('store_id', storeId)
      .order('shipped_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      shipments: data || [],
      total: count || 0
    };
  } catch (error) {
    console.error('Error getting shipments:', error);
    throw error;
  }
}

/**
 * Export orders as professional Excel file with Ordefy branding
 * This is for ad-hoc exports (without creating a dispatch session)
 */
export async function exportOrdersExcel(
  storeId: string,
  orderIds: string[],
  carrierName: string
): Promise<Buffer> {
  // Fetch orders with full details
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select(`
      id,
      shopify_order_name,
      shopify_order_number,
      customer_first_name,
      customer_last_name,
      customer_phone,
      customer_address,
      customer_city,
      payment_method,
      financial_status,
      total_price,
      cod_amount,
      carriers!courier_id (
        id,
        name,
        delivery_fee
      )
    `)
    .eq('store_id', storeId)
    .in('id', orderIds);

  if (error) throw error;

  const dateStr = new Date().toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const sessionInfo = `Transportadora: ${carrierName} | Fecha: ${dateStr} | Pedidos: ${orders?.length || 0}`;

  const dispatchOrders: DispatchOrder[] = (orders || []).map((order: any) => {
    // Determine order number display
    let orderNumber: string;
    if (order.shopify_order_name) {
      orderNumber = order.shopify_order_name;
    } else if (order.shopify_order_number) {
      orderNumber = `#${order.shopify_order_number}`;
    } else {
      orderNumber = `ORD-${order.id.slice(0, 8).toUpperCase()}`;
    }

    // Determine payment type and amount to collect
    // IMPORTANT: financial_status (from Shopify) takes precedence over payment_method
    // This matches the logic in settlements.service.ts for consistency
    const financialStatus = (order.financial_status || '').toLowerCase();
    const isPaidOnline = financialStatus === 'paid' || financialStatus === 'authorized';

    // Use centralized payment utilities, but financial_status overrides
    // If Shopify says it's paid, it's NOT COD regardless of payment_method
    const isCod = !isPaidOnline && isCodPayment(order.payment_method);

    let paymentType: string;
    let amountToCollect: number;

    if (isCod) {
      // COD: Courier must collect cash on delivery
      paymentType = 'COD';
      amountToCollect = order.cod_amount || order.total_price || 0;
    } else if (isPaidOnline) {
      // Paid online (confirmed by Shopify financial_status)
      paymentType = '✓ PAGADO';
      amountToCollect = 0;
    } else {
      // Prepaid but not yet confirmed by Shopify (bank transfer, QR, etc.)
      // Or unknown payment status - assume prepaid to avoid collecting incorrectly
      paymentType = 'PREPAGO';
      amountToCollect = 0;
    }

    // Extract city from address if not available
    let city = order.customer_city || '';
    if (!city && order.customer_address) {
      const addressParts = order.customer_address.split(',').map(part => part.trim());
      // Remove empty strings from split result
      const validParts = addressParts.filter(p => p.length > 0);

      if (validParts.length > 0) {
        // Use last non-empty part as city
        city = validParts[validParts.length - 1];
      }
    }

    return {
      orderNumber,
      customerName: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
      customerPhone: order.customer_phone || '',
      deliveryAddress: order.customer_address || '',
      deliveryCity: city,
      paymentType,
      amountToCollect,
      carrierFee: order.carriers?.delivery_fee || 0
    };
  });

  return await generateDispatchExcel(sessionInfo, dispatchOrders);
}

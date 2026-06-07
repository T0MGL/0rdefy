/**
 * Shipping Service
 * Manages the dispatch of orders to couriers
 * Handles the transition from ready_to_ship → shipped status
 */

import { logger } from '../utils/logger';
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
 * Gets all orders ready to ship for a store.
 *
 * Filters (Wave Dispatch, Migration 178):
 *   - productIds: restrict to mono-product orders for the given products
 *     (uses get_mono_product_order_ids RPC). Multi-product orders are
 *     excluded server-side. This is the safe path: a batch is never
 *     silently mixed with multi-product orders.
 *   - mixedOnly: restrict to orders that have line items belonging to
 *     two or more distinct products. Used by the "Mixtos" deep link to
 *     surface every order that needs special operator attention.
 *
 * The two filters are mutually exclusive at the call site; if both are
 * supplied, productIds wins.
 */
export async function getReadyToShipOrders(
  storeId: string,
  productIds?: string[],
  mixedOnly: boolean = false
): Promise<ReadyToShipOrder[]> {
  try {
    let query = supabaseAdmin
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
        carriers:courier_id (
          id,
          name
        )
      `)
      .eq('store_id', storeId)
      .eq('sleeves_status', 'ready_to_ship')
      .order('created_at', { ascending: true });

    if (productIds && productIds.length > 0) {
      const { data: monoRows, error: monoError } = await supabaseAdmin.rpc(
        'get_mono_product_order_ids',
        { p_store_id: storeId, p_product_ids: productIds }
      );

      if (monoError) {
        logger.error('BACKEND', 'get_mono_product_order_ids RPC failed', monoError);
        throw monoError;
      }

      const monoOrderIds = (monoRows || []).map((row: { order_id: string }) => row.order_id);
      if (monoOrderIds.length === 0) {
        return [];
      }

      query = query.in('id', monoOrderIds);
    } else if (mixedOnly) {
      // Find orders with 2+ distinct product_ids in their line items.
      // The set is small (only ready_to_ship orders), so a single query
      // resolves it with no RPC required.
      const { data: liRows, error: liError } = await supabaseAdmin
        .from('order_line_items')
        .select('order_id, product_id, orders!inner(store_id, sleeves_status, deleted_at)')
        .eq('orders.store_id', storeId)
        .eq('orders.sleeves_status', 'ready_to_ship')
        .is('orders.deleted_at', null);

      if (liError) {
        logger.error('BACKEND', 'mixed-only line-items query failed', liError);
        throw liError;
      }

      const productsByOrder = new Map<string, Set<string>>();
      for (const row of liRows || []) {
        const orderId = (row as { order_id: string }).order_id;
        const productId = (row as { product_id: string | null }).product_id;
        if (!orderId || !productId) continue;
        const set = productsByOrder.get(orderId) || new Set<string>();
        set.add(productId);
        productsByOrder.set(orderId, set);
      }

      const mixedOrderIds = Array.from(productsByOrder.entries())
        .filter(([, set]) => set.size > 1)
        .map(([orderId]) => orderId);

      if (mixedOrderIds.length === 0) {
        return [];
      }

      query = query.in('id', mixedOrderIds);
    }

    const { data: orders, error } = await query;

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
    logger.error('BACKEND', 'Error getting ready to ship orders:', error);
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
    logger.error('BACKEND', 'Error creating shipment:', error);
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
    logger.error('BACKEND', 'Error creating batch shipments:', error);
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
      .select('id, store_id, order_id, courier_id, shipped_at, shipped_by, notes, created_at, updated_at')
      .eq('order_id', orderId)
      .eq('store_id', storeId)
      // Exclude carrier push bookkeeping rows that have not dispatched yet
      // (carrier_provider set, carrier_external_id still null). Those are
      // pending/failed push records, not real dispatched shipments.
      .or('carrier_external_id.not.is.null,carrier_provider.is.null')
      .order('shipped_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    logger.error('BACKEND', 'Error getting order shipments:', error);
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
    // Get total count. Excludes carrier push bookkeeping rows (provider set,
    // external id still null): a pending/failed push is not a real shipment and
    // must not inflate the count or appear in history.
    const { count, error: countError } = await supabaseAdmin
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .or('carrier_external_id.not.is.null,carrier_provider.is.null');

    if (countError) throw countError;

    // Get shipments
    const { data, error } = await supabaseAdmin
      .from('shipments')
      .select('id, store_id, order_id, courier_id, shipped_at, shipped_by, notes, created_at, updated_at')
      .eq('store_id', storeId)
      .or('carrier_external_id.not.is.null,carrier_provider.is.null')
      .order('shipped_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      shipments: data || [],
      total: count || 0
    };
  } catch (error) {
    logger.error('BACKEND', 'Error getting shipments:', error);
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
      prepaid_method,
      financial_status,
      total_price,
      cod_amount,
      carriers:courier_id (
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
    // NOT COD if: financial_status is 'paid' (Shopify) OR prepaid_method is set (Ordefy mark as prepaid)
    const isCod = !isPaidOnline && !order.prepaid_method && isCodPayment(order.payment_method);

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
      const addressParts = order.customer_address.split(',').map((part: string) => part.trim());
      // Remove empty strings from split result
      const validParts = addressParts.filter((p: string) => p.length > 0);

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

// ============================================================================
// Wave Dispatch (Migration 178)
// ============================================================================

export interface DispatchProductSummary {
  product_id: string | null;
  product_name: string;
  product_image: string | null;
  order_count: number;
  unit_count: number;
  cod_total: number;
  is_mono: boolean;
}

export interface PickListRow {
  product_id: string | null;
  product_name: string;
  variant_id: string | null;
  variant_title: string | null;
  sku: string | null;
  total_quantity: number;
}

/**
 * Returns one row per product (plus a single "Mixtos" row for multi-product
 * orders) for the ready-to-ship dispatch view. Source of truth for the cards
 * UI in /shipping. Powered by get_dispatch_product_summary RPC.
 */
export async function getDispatchSummary(
  storeId: string
): Promise<DispatchProductSummary[]> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_dispatch_product_summary', {
      p_store_id: storeId,
    });

    if (error) {
      logger.error('BACKEND', 'get_dispatch_product_summary RPC failed', error);
      throw error;
    }

    return (data || []).map((row: {
      product_id: string | null;
      product_name: string;
      product_image: string | null;
      order_count: number | string;
      unit_count: number | string;
      cod_total: number | string;
      is_mono: boolean;
    }) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      product_image: row.product_image,
      order_count: Number(row.order_count) || 0,
      unit_count: Number(row.unit_count) || 0,
      cod_total: Number(row.cod_total) || 0,
      is_mono: row.is_mono,
    }));
  } catch (error) {
    logger.error('BACKEND', 'Error getting dispatch summary:', error);
    throw error;
  }
}

/**
 * Returns variant-level aggregated quantities for a given set of orders.
 * Used by the printable pick list PDF. Quantities are summed across all
 * line items that share the same variant_id (or product_id when no variant
 * is set), giving the picker a single number per physical SKU to pull.
 */
export async function getPickList(
  storeId: string,
  orderIds: string[]
): Promise<PickListRow[]> {
  try {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return [];
    }

    const { data, error } = await supabaseAdmin.rpc('get_pick_list_for_orders', {
      p_store_id: storeId,
      p_order_ids: orderIds,
    });

    if (error) {
      logger.error('BACKEND', 'get_pick_list_for_orders RPC failed', error);
      throw error;
    }

    return (data || []).map((row: {
      product_id: string | null;
      product_name: string;
      variant_id: string | null;
      variant_title: string | null;
      sku: string | null;
      total_quantity: number | string;
    }) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      variant_id: row.variant_id,
      variant_title: row.variant_title,
      sku: row.sku,
      total_quantity: Number(row.total_quantity) || 0,
    }));
  } catch (error) {
    logger.error('BACKEND', 'Error getting pick list:', error);
    throw error;
  }
}

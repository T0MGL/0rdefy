/**
 * Settlements Service
 * Manages dispatch sessions, daily settlements, and carrier reconciliation
 *
 * Flow:
 *   1. Create dispatch session with orders
 *   2. Export CSV for courier
 *   3. Import CSV results (update delivery statuses)
 *   4. Process settlement (calculate financials)
 *   5. Mark settlement as paid
 */

import { supabaseAdmin } from '../db/connection';
import {
  isCodPayment,
  normalizePaymentMethod,
  getPaymentTypeLabel,
  getAmountToCollect,
  validateAmountCollected
} from '../utils/payment';

// ============================================================
// TYPES
// ============================================================

export interface DispatchSession {
  id: string;
  store_id: string;
  carrier_id: string;
  session_code: string;
  dispatch_date: string;
  total_orders: number;
  total_cod_expected: number;
  total_prepaid: number;
  status: 'dispatched' | 'processing' | 'settled' | 'cancelled';
  daily_settlement_id: string | null;
  created_at: string;
  updated_at: string;
  exported_at: string | null;
  imported_at: string | null;
  settled_at: string | null;
  created_by: string | null;
  // Joined fields
  carrier_name?: string;
}

export interface DispatchSessionOrder {
  id: string;
  dispatch_session_id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_city: string;
  delivery_zone: string;
  total_price: number;
  payment_method: string;
  is_cod: boolean;
  carrier_fee: number;
  delivery_status: 'pending' | 'delivered' | 'not_delivered' | 'rejected' | 'rescheduled' | 'returned';
  amount_collected: number | null;
  failure_reason: string | null;
  courier_notes: string | null;
  delivered_at: string | null;
  processed_at: string | null;
}

export interface DailySettlement {
  id: string;
  store_id: string;
  carrier_id: string;
  dispatch_session_id: string | null;
  settlement_code: string;
  settlement_date: string;
  total_dispatched: number;
  total_delivered: number;
  total_not_delivered: number;
  total_cod_delivered: number;
  total_prepaid_delivered: number;
  total_cod_collected: number;
  total_carrier_fees: number;
  failed_attempt_fee: number;
  net_receivable: number;
  status: 'pending' | 'partial' | 'paid' | 'disputed' | 'cancelled';
  amount_paid: number;
  balance_due: number;
  payment_date: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  notes: string | null;
  dispute_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  carrier_name?: string;
}

export interface CarrierZone {
  id: string;
  store_id: string;
  carrier_id: string;
  zone_name: string;
  zone_code: string | null;
  rate: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ImportRow {
  order_number: string;
  delivery_status: string;
  amount_collected?: number;
  failure_reason?: string;
  courier_notes?: string;
}

// ============================================================
// DISPATCH SESSIONS
// ============================================================

/**
 * Get orders ready to be dispatched (confirmed status, not in any session)
 */
export async function getOrdersToDispatch(
  storeId: string,
  carrierId?: string
): Promise<{ data: any[]; count: number }> {
  // Get orders that are confirmed and not already in a dispatch session
  // Note: orders table uses 'courier_id' for carrier reference and 'sleeves_status' for order status
  let query = supabaseAdmin
    .from('orders')
    .select(`
      id,
      order_number,
      shopify_order_number,
      customer_first_name,
      customer_last_name,
      customer_phone,
      shipping_address,
      total_price,
      payment_method,
      payment_status,
      courier_id,
      sleeves_status,
      shipping_cost,
      delivery_zone,
      created_at,
      carriers:courier_id(name)
    `, { count: 'exact' })
    .eq('store_id', storeId)
    .eq('sleeves_status', 'confirmed')
    .order('created_at', { ascending: true });

  if (carrierId) {
    query = query.eq('courier_id', carrierId);
  }

  const { data: orders, error, count } = await query;

  if (error) throw error;

  // Get order IDs already in dispatch sessions
  const { data: dispatchedOrders } = await supabaseAdmin
    .from('dispatch_session_orders')
    .select('order_id')
    .in('order_id', (orders || []).map(o => o.id));

  const dispatchedOrderIds = new Set((dispatchedOrders || []).map(d => d.order_id));

  // Filter out orders already in dispatch sessions
  const availableOrders = (orders || []).filter(o => !dispatchedOrderIds.has(o.id));

  // Transform to flatten carrier name
  const transformedOrders = availableOrders.map((o: any) => ({
    ...o,
    carrier_name: o.carriers?.name,
    carriers: undefined
  }));

  return { data: transformedOrders, count: transformedOrders.length };
}

/**
 * Get all dispatch sessions for a store
 */
export async function getDispatchSessions(
  storeId: string,
  options: {
    status?: string;
    carrierId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ data: DispatchSession[]; count: number }> {
  let query = supabaseAdmin
    .from('dispatch_sessions')
    .select(`
      *,
      carriers!inner(name)
    `, { count: 'exact' })
    .eq('store_id', storeId)
    .order('dispatch_date', { ascending: false });

  if (options.status) {
    query = query.eq('status', options.status);
  }
  if (options.carrierId) {
    query = query.eq('carrier_id', options.carrierId);
  }
  if (options.startDate) {
    query = query.gte('dispatch_date', options.startDate);
  }
  if (options.endDate) {
    query = query.lte('dispatch_date', options.endDate);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
  }

  const { data, error, count } = await query;

  if (error) throw error;

  // Transform to flatten carrier name
  const sessions = (data || []).map((s: any) => ({
    ...s,
    carrier_name: s.carriers?.name,
    carriers: undefined
  }));

  return { data: sessions, count: count || 0 };
}

/**
 * Get dispatch session by ID with orders
 */
export async function getDispatchSessionById(
  sessionId: string,
  storeId: string
): Promise<DispatchSession & { orders: DispatchSessionOrder[] }> {
  // Get session
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('dispatch_sessions')
    .select(`
      *,
      carriers!inner(name)
    `)
    .eq('id', sessionId)
    .eq('store_id', storeId)
    .single();

  if (sessionError) throw sessionError;
  if (!session) throw new Error('Dispatch session not found');

  // Get orders
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('dispatch_session_orders')
    .select('*')
    .eq('dispatch_session_id', sessionId)
    .order('order_number');

  if (ordersError) throw ordersError;

  return {
    ...session,
    carrier_name: session.carriers?.name,
    carriers: undefined,
    orders: orders || []
  };
}

/**
 * Create a new dispatch session with orders
 */
export async function createDispatchSession(
  storeId: string,
  carrierId: string,
  orderIds: string[],
  userId: string
): Promise<DispatchSession> {
  // Generate session code
  const today = new Date();
  const dateStr = today.toLocaleDateString('es-PY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '');

  // Count existing sessions today
  const { count } = await supabaseAdmin
    .from('dispatch_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('dispatch_date', today.toISOString().split('T')[0]);

  const sessionNumber = ((count || 0) + 1).toString().padStart(2, '0');
  const sessionCode = `DISP-${dateStr}-${sessionNumber}`;

  // Get carrier zones for rate lookup
  const { data: zones } = await supabaseAdmin
    .from('carrier_zones')
    .select('*')
    .eq('carrier_id', carrierId)
    .eq('is_active', true);

  const zoneMap = new Map<string, number>();
  (zones || []).forEach(z => {
    zoneMap.set(z.zone_name.toLowerCase(), z.rate);
  });

  // Get orders with customer and product info
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      customers(name, phone)
    `)
    .in('id', orderIds)
    .eq('store_id', storeId);

  if (ordersError) throw ordersError;
  if (!orders || orders.length === 0) {
    throw new Error('No orders found');
  }

  // Create session
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('dispatch_sessions')
    .insert({
      store_id: storeId,
      carrier_id: carrierId,
      session_code: sessionCode,
      dispatch_date: today.toISOString().split('T')[0],
      total_orders: orders.length,
      status: 'dispatched',
      created_by: userId,
      exported_at: new Date().toISOString()
    })
    .select()
    .single();

  if (sessionError) throw sessionError;

  // Prepare session orders
  let totalCodExpected = 0;
  let totalPrepaid = 0;
  let totalPrepaidCarrierFees = 0;

  const sessionOrders = orders.map(order => {
    const city = order.shipping_city || order.delivery_zone || '';
    const rate = zoneMap.get(city.toLowerCase()) || zoneMap.get('default') || 0;

    // Use centralized payment utilities for COD determination
    const isCod = isCodPayment(order.payment_method);
    const normalizedMethod = normalizePaymentMethod(order.payment_method);

    if (isCod) {
      totalCodExpected += order.total_price || 0;
    } else {
      totalPrepaid++;
      totalPrepaidCarrierFees += rate;
    }

    return {
      dispatch_session_id: session.id,
      order_id: order.id,
      order_number: order.order_number,
      customer_name: order.customers?.name || order.customer_name || '',
      customer_phone: order.customers?.phone || order.customer_phone || '',
      delivery_address: [order.shipping_address, order.shipping_reference].filter(Boolean).join(', '),
      delivery_city: order.shipping_city || '',
      delivery_zone: order.delivery_zone || order.shipping_city || '',
      total_price: order.total_price || 0,
      payment_method: normalizedMethod,
      is_cod: isCod,
      carrier_fee: rate,
      delivery_status: 'pending'
    };
  });

  console.log(`📦 [DISPATCH] Creating session with ${orders.length} orders:`, {
    total_cod_orders: sessionOrders.filter(o => o.is_cod).length,
    total_prepaid_orders: totalPrepaid,
    total_cod_expected: totalCodExpected,
    total_prepaid_carrier_fees: totalPrepaidCarrierFees
  });

  // Insert session orders
  const { error: insertError } = await supabaseAdmin
    .from('dispatch_session_orders')
    .insert(sessionOrders);

  if (insertError) throw insertError;

  // Update session totals
  await supabaseAdmin
    .from('dispatch_sessions')
    .update({
      total_cod_expected: totalCodExpected,
      total_prepaid: totalPrepaid
    })
    .eq('id', session.id);

  // Update orders to shipped status
  await supabaseAdmin
    .from('orders')
    .update({
      sleeves_status: 'shipped',
      courier_id: carrierId,
      shipped_at: new Date().toISOString()
    })
    .in('id', orderIds);

  return session;
}

/**
 * Export dispatch session as CSV for courier
 *
 * CSV Format explanation:
 * - TIPO_PAGO: "COD" means courier must collect, "PREPAGO" means already paid
 * - A_COBRAR: Amount courier should collect (0 for prepaid)
 * - MONTO_COBRADO: Courier fills with actual collected amount
 *
 * For PREPAID orders:
 * - A_COBRAR = 0 (nothing to collect)
 * - MONTO_COBRADO should remain 0
 * - Courier still earns their carrier_fee (store pays them)
 */
export async function exportDispatchCSV(
  sessionId: string,
  storeId: string
): Promise<string> {
  const session = await getDispatchSessionById(sessionId, storeId);

  // CSV headers matching the format the courier expects
  // Added TIPO_PAGO and A_COBRAR for clarity
  const headers = [
    'NroReferencia',
    'Telefono',
    'NOMBRE Y APELLIDO',
    'Direccion',
    'CIUDAD',
    'TIPO_PAGO',             // NEW: "COD" or "PREPAGO" - clear indicator
    'A_COBRAR',              // NEW: Amount to collect (0 for prepaid)
    'IMPORTE_TOTAL',         // Total order value (for reference)
    'Tarifa_Envio',
    'ESTADO_ENTREGA',        // Courier fills: ENTREGADO, NO ENTREGADO, RECHAZADO
    'MONTO_COBRADO',         // Courier fills: actual amount collected
    'MOTIVO_NO_ENTREGA',     // Courier fills: reason if not delivered
    'OBSERVACIONES'          // Courier fills: notes
  ];

  const rows = session.orders.map(order => {
    // Use centralized utilities for payment type determination
    const paymentType = order.is_cod ? 'COD' : 'PREPAGO';
    const amountToCollect = getAmountToCollect(order.payment_method, order.total_price);

    return [
      order.order_number,
      order.customer_phone,
      order.customer_name,
      order.delivery_address,
      order.delivery_city,
      paymentType,                           // TIPO_PAGO
      amountToCollect.toString(),            // A_COBRAR
      order.total_price.toString(),          // IMPORTE_TOTAL (for reference)
      order.carrier_fee.toString(),
      '',                                    // ESTADO_ENTREGA - courier fills
      '',                                    // MONTO_COBRADO - courier fills (should be 0 for prepaid)
      '',                                    // MOTIVO_NO_ENTREGA - courier fills
      ''                                     // OBSERVACIONES - courier fills
    ];
  });

  // Build CSV
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Import delivery results from CSV
 *
 * IMPORTANT: Handles COD vs PREPAID correctly:
 * - COD orders: amount_collected = what courier actually collected
 * - PREPAID orders: amount_collected = 0 (validates this)
 *
 * Warnings are generated for:
 * - PREPAID orders where courier reported collecting money (data inconsistency)
 * - COD orders where amount differs from expected (discrepancy)
 */
export async function importDispatchResults(
  sessionId: string,
  storeId: string,
  results: ImportRow[]
): Promise<{ processed: number; errors: string[]; warnings: string[] }> {
  const session = await getDispatchSessionById(sessionId, storeId);

  if (session.status === 'settled') {
    throw new Error('Session already settled');
  }

  let processed = 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Map order numbers to session orders
  const orderMap = new Map<string, DispatchSessionOrder>();
  session.orders.forEach(o => orderMap.set(o.order_number, o));

  for (const row of results) {
    const sessionOrder = orderMap.get(row.order_number);

    if (!sessionOrder) {
      errors.push(`Order ${row.order_number} not found in this session`);
      continue;
    }

    // Map status from CSV to our enum
    let deliveryStatus: DispatchSessionOrder['delivery_status'] = 'pending';
    const statusUpper = (row.delivery_status || '').toUpperCase().trim();

    if (statusUpper === 'ENTREGADO' || statusUpper === 'DELIVERED') {
      deliveryStatus = 'delivered';
    } else if (statusUpper === 'NO ENTREGADO' || statusUpper === 'NOT_DELIVERED') {
      deliveryStatus = 'not_delivered';
    } else if (statusUpper === 'RECHAZADO' || statusUpper === 'REJECTED') {
      deliveryStatus = 'rejected';
    } else if (statusUpper === 'REPROGRAMADO' || statusUpper === 'RESCHEDULED') {
      deliveryStatus = 'rescheduled';
    } else if (statusUpper === 'DEVUELTO' || statusUpper === 'RETURNED') {
      deliveryStatus = 'returned';
    }

    // Map failure reason
    let failureReason: string | null = null;
    if (row.failure_reason) {
      const reasonUpper = row.failure_reason.toUpperCase().trim();
      if (reasonUpper.includes('NO CONTESTA')) failureReason = 'no_answer';
      else if (reasonUpper.includes('DIRECCION')) failureReason = 'wrong_address';
      else if (reasonUpper.includes('AUSENTE')) failureReason = 'customer_absent';
      else if (reasonUpper.includes('RECHAZ')) failureReason = 'customer_rejected';
      else if (reasonUpper.includes('DINERO') || reasonUpper.includes('FONDOS')) failureReason = 'insufficient_funds';
      else if (reasonUpper.includes('NO SE ENCONTR')) failureReason = 'address_not_found';
      else if (reasonUpper.includes('REPROGRAM')) failureReason = 'rescheduled';
      else failureReason = 'other';
    }

    // Calculate amount collected based on payment type
    let amountCollected: number;

    if (deliveryStatus === 'delivered') {
      if (sessionOrder.is_cod) {
        // COD order: use reported amount or default to full price
        if (row.amount_collected !== undefined && row.amount_collected !== null) {
          amountCollected = row.amount_collected;

          // Check for discrepancy
          if (amountCollected !== sessionOrder.total_price) {
            warnings.push(
              `⚠️ Pedido ${row.order_number}: Discrepancia de monto - Esperado: ${sessionOrder.total_price}, Cobrado: ${amountCollected}`
            );
          }
        } else {
          // Default: assume full amount collected
          amountCollected = sessionOrder.total_price;
        }
      } else {
        // PREPAID order: should NOT collect any money
        amountCollected = 0;

        // Warn if courier reported collecting money for a prepaid order
        if (row.amount_collected !== undefined && row.amount_collected !== null && row.amount_collected > 0) {
          warnings.push(
            `⚠️ Pedido ${row.order_number}: Es PREPAGO pero el courier reportó cobrar ${row.amount_collected}. Se registrará como 0.`
          );
        }
      }
    } else {
      // Not delivered - no amount collected
      amountCollected = 0;
    }

    // Update session order
    const { error } = await supabaseAdmin
      .from('dispatch_session_orders')
      .update({
        delivery_status: deliveryStatus,
        amount_collected: amountCollected,
        failure_reason: failureReason,
        courier_notes: row.courier_notes || null,
        delivered_at: deliveryStatus === 'delivered' ? new Date().toISOString() : null,
        processed_at: new Date().toISOString()
      })
      .eq('id', sessionOrder.id);

    if (error) {
      errors.push(`Error updating ${row.order_number}: ${error.message}`);
    } else {
      processed++;
    }

    // Also update the main orders table with amount_collected and discrepancy flag
    if (deliveryStatus === 'delivered' && sessionOrder.is_cod) {
      const hasDiscrepancy = amountCollected !== sessionOrder.total_price;
      await supabaseAdmin
        .from('orders')
        .update({
          amount_collected: amountCollected,
          has_amount_discrepancy: hasDiscrepancy
        })
        .eq('id', sessionOrder.order_id);
    }
  }

  // Update session status
  await supabaseAdmin
    .from('dispatch_sessions')
    .update({
      status: 'processing',
      imported_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  return { processed, errors, warnings };
}

// ============================================================
// SETTLEMENTS
// ============================================================

/**
 * Process dispatch session and create settlement
 *
 * IMPORTANT: Settlement calculation logic
 *
 * For COD orders (cash on delivery):
 *   - Courier collects money from customer (amount_collected)
 *   - Courier keeps their fee (carrier_fee)
 *   - Store receives: amount_collected - carrier_fee
 *
 * For PREPAID orders (card, QR, transfer):
 *   - Payment already received by store (amount_collected = 0)
 *   - Store must PAY the courier their fee (carrier_fee)
 *   - Net result: store owes courier the carrier_fee
 *
 * Net Receivable Formula:
 *   net_receivable = total_cod_collected - total_carrier_fees_cod - total_carrier_fees_prepaid - failed_attempt_fees
 *
 * If net_receivable > 0: Courier owes store money
 * If net_receivable < 0: Store owes courier money (common when mostly prepaid orders)
 */
export async function processSettlement(
  sessionId: string,
  storeId: string,
  userId: string
): Promise<DailySettlement> {
  const session = await getDispatchSessionById(sessionId, storeId);

  if (session.status === 'settled') {
    throw new Error('Session already settled');
  }

  // Calculate statistics with proper COD vs PREPAID separation
  const stats = {
    total_dispatched: session.orders.length,
    total_delivered: 0,
    total_not_delivered: 0,
    total_cod_delivered: 0,
    total_prepaid_delivered: 0,
    // COD specific - money courier collected from customers
    total_cod_collected: 0,
    // Carrier fees separated by payment type for clarity
    total_carrier_fees: 0,           // Total fees (COD + prepaid)
    total_carrier_fees_cod: 0,       // Fees for COD orders (deducted from collected)
    total_carrier_fees_prepaid: 0,   // Fees for prepaid orders (store must pay)
    failed_attempt_fee: 0,
    // Discrepancy tracking
    total_discrepancies: 0,
    discrepancy_details: [] as Array<{order_number: string, expected: number, collected: number, difference: number}>
  };

  for (const order of session.orders) {
    if (order.delivery_status === 'delivered') {
      stats.total_delivered++;
      stats.total_carrier_fees += order.carrier_fee || 0;

      if (order.is_cod) {
        // COD order: courier collected money from customer
        stats.total_cod_delivered++;
        stats.total_cod_collected += order.amount_collected || 0;
        stats.total_carrier_fees_cod += order.carrier_fee || 0;

        // Track discrepancies for COD orders
        const expectedAmount = order.total_price || 0;
        const collectedAmount = order.amount_collected || 0;
        if (collectedAmount !== expectedAmount && collectedAmount > 0) {
          stats.total_discrepancies++;
          stats.discrepancy_details.push({
            order_number: order.order_number,
            expected: expectedAmount,
            collected: collectedAmount,
            difference: collectedAmount - expectedAmount
          });
        }
      } else {
        // PREPAID order: payment already in store's account
        // Courier didn't collect anything, but store owes them the carrier fee
        stats.total_prepaid_delivered++;
        stats.total_carrier_fees_prepaid += order.carrier_fee || 0;

        // Validate: prepaid orders should have amount_collected = 0
        if ((order.amount_collected || 0) > 0) {
          console.warn(`⚠️ [SETTLEMENT] Prepaid order ${order.order_number} has amount_collected=${order.amount_collected}. This should be 0.`);
        }
      }
    } else if (['not_delivered', 'rejected', 'returned'].includes(order.delivery_status)) {
      stats.total_not_delivered++;
      // Some carriers charge 50% for failed attempts
      stats.failed_attempt_fee += (order.carrier_fee || 0) * 0.5;
    }
  }

  // Generate settlement code
  const today = new Date();
  const dateStr = today.toLocaleDateString('es-PY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '');

  const { count } = await supabaseAdmin
    .from('daily_settlements')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('settlement_date', today.toISOString().split('T')[0]);

  const settlementNumber = ((count || 0) + 1).toString().padStart(2, '0');
  const settlementCode = `LIQ-${dateStr}-${settlementNumber}`;

  // Calculate net receivable
  // CORRECT FORMULA:
  // - Courier collected COD money: +total_cod_collected
  // - Courier keeps fees for COD orders: -total_carrier_fees_cod
  // - Store must pay courier for prepaid deliveries: -total_carrier_fees_prepaid
  // - Fees for failed attempts (usually 50%): -failed_attempt_fee
  //
  // net_receivable = what courier owes store (positive) or what store owes courier (negative)
  const netReceivable = stats.total_cod_collected - stats.total_carrier_fees - stats.failed_attempt_fee;
  const balanceDue = netReceivable; // Initially balance_due equals net_receivable

  // Log settlement calculation for debugging
  console.log(`📊 [SETTLEMENT] Session ${session.session_code}:`, {
    total_cod_delivered: stats.total_cod_delivered,
    total_prepaid_delivered: stats.total_prepaid_delivered,
    total_cod_collected: stats.total_cod_collected,
    total_carrier_fees_cod: stats.total_carrier_fees_cod,
    total_carrier_fees_prepaid: stats.total_carrier_fees_prepaid,
    total_carrier_fees: stats.total_carrier_fees,
    failed_attempt_fee: stats.failed_attempt_fee,
    net_receivable: netReceivable,
    discrepancies: stats.total_discrepancies
  });

  // Create settlement
  const { data: settlement, error: settlementError } = await supabaseAdmin
    .from('daily_settlements')
    .insert({
      store_id: storeId,
      carrier_id: session.carrier_id,
      dispatch_session_id: sessionId,
      settlement_code: settlementCode,
      settlement_date: today.toISOString().split('T')[0],
      ...stats,
      net_receivable: netReceivable,
      balance_due: balanceDue,
      amount_paid: 0,
      status: 'pending',
      created_by: userId
    })
    .select()
    .single();

  if (settlementError) throw settlementError;

  // Update dispatch session
  await supabaseAdmin
    .from('dispatch_sessions')
    .update({
      status: 'settled',
      daily_settlement_id: settlement.id,
      settled_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  // Update order statuses in main orders table
  for (const order of session.orders) {
    if (order.delivery_status === 'pending') continue;

    let newStatus = order.delivery_status;
    if (order.delivery_status === 'not_delivered') {
      newStatus = 'shipped'; // Keep as shipped for retry
    }

    await supabaseAdmin
      .from('orders')
      .update({
        sleeves_status: newStatus,
        delivered_at: order.delivery_status === 'delivered' ? order.delivered_at : null
      })
      .eq('id', order.order_id);
  }

  return settlement;
}

/**
 * Get all daily settlements for a store
 */
export async function getDailySettlements(
  storeId: string,
  options: {
    status?: string;
    carrierId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ data: DailySettlement[]; count: number }> {
  let query = supabaseAdmin
    .from('daily_settlements')
    .select(`
      *,
      carriers!inner(name)
    `, { count: 'exact' })
    .eq('store_id', storeId)
    .order('settlement_date', { ascending: false });

  if (options.status) {
    query = query.eq('status', options.status);
  }
  if (options.carrierId) {
    query = query.eq('carrier_id', options.carrierId);
  }
  if (options.startDate) {
    query = query.gte('settlement_date', options.startDate);
  }
  if (options.endDate) {
    query = query.lte('settlement_date', options.endDate);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
  }

  const { data, error, count } = await query;

  if (error) throw error;

  const settlements = (data || []).map((s: any) => ({
    ...s,
    carrier_name: s.carriers?.name,
    carriers: undefined
  }));

  return { data: settlements, count: count || 0 };
}

/**
 * Get settlement by ID
 */
export async function getSettlementById(
  settlementId: string,
  storeId: string
): Promise<DailySettlement & { dispatch_session?: DispatchSession; orders?: DispatchSessionOrder[] }> {
  const { data: settlement, error } = await supabaseAdmin
    .from('daily_settlements')
    .select(`
      *,
      carriers!inner(name)
    `)
    .eq('id', settlementId)
    .eq('store_id', storeId)
    .single();

  if (error) throw error;
  if (!settlement) throw new Error('Settlement not found');

  let dispatchSession: DispatchSession | undefined;
  let orders: DispatchSessionOrder[] | undefined;

  if (settlement.dispatch_session_id) {
    const sessionResult = await getDispatchSessionById(settlement.dispatch_session_id, storeId);
    dispatchSession = sessionResult;
    orders = sessionResult.orders;
  }

  return {
    ...settlement,
    carrier_name: settlement.carriers?.name,
    carriers: undefined,
    dispatch_session: dispatchSession,
    orders
  };
}

/**
 * Mark settlement as paid (partial or full)
 */
export async function markSettlementPaid(
  settlementId: string,
  storeId: string,
  payment: {
    amount: number;
    method: string;
    reference?: string;
    notes?: string;
  }
): Promise<DailySettlement> {
  const { data: settlement, error: fetchError } = await supabaseAdmin
    .from('daily_settlements')
    .select('*')
    .eq('id', settlementId)
    .eq('store_id', storeId)
    .single();

  if (fetchError) throw fetchError;
  if (!settlement) throw new Error('Settlement not found');

  const newAmountPaid = (settlement.amount_paid || 0) + payment.amount;
  const netReceivable = settlement.net_receivable || 0;
  const newBalanceDue = netReceivable - newAmountPaid;
  const newStatus = newAmountPaid >= netReceivable ? 'paid' : 'partial';

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('daily_settlements')
    .update({
      amount_paid: newAmountPaid,
      balance_due: newBalanceDue,
      status: newStatus,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: payment.method,
      payment_reference: payment.reference || settlement.payment_reference,
      notes: payment.notes || settlement.notes
    })
    .eq('id', settlementId)
    .select()
    .single();

  if (updateError) throw updateError;

  return updated;
}

// ============================================================
// CARRIER ZONES
// ============================================================

/**
 * Get carrier zones
 */
export async function getCarrierZones(
  storeId: string,
  carrierId?: string
): Promise<CarrierZone[]> {
  let query = supabaseAdmin
    .from('carrier_zones')
    .select('*')
    .eq('store_id', storeId)
    .order('zone_name');

  if (carrierId) {
    query = query.eq('carrier_id', carrierId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return data || [];
}

/**
 * Create or update carrier zone
 */
export async function upsertCarrierZone(
  storeId: string,
  carrierId: string,
  zone: {
    zone_name: string;
    zone_code?: string;
    rate: number;
    is_active?: boolean;
  }
): Promise<CarrierZone> {
  const { data, error } = await supabaseAdmin
    .from('carrier_zones')
    .upsert({
      store_id: storeId,
      carrier_id: carrierId,
      zone_name: zone.zone_name,
      zone_code: zone.zone_code || null,
      rate: zone.rate,
      is_active: zone.is_active !== false
    }, {
      onConflict: 'carrier_id,zone_name'
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/**
 * Bulk upsert carrier zones (for importing from Excel)
 */
export async function bulkUpsertCarrierZones(
  storeId: string,
  carrierId: string,
  zones: Array<{
    zone_name: string;
    zone_code?: string;
    rate: number;
  }>
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const zone of zones) {
    // Check if exists
    const { data: existing } = await supabaseAdmin
      .from('carrier_zones')
      .select('id')
      .eq('carrier_id', carrierId)
      .eq('zone_name', zone.zone_name)
      .single();

    if (existing) {
      updated++;
    } else {
      created++;
    }

    await upsertCarrierZone(storeId, carrierId, zone);
  }

  return { created, updated };
}

/**
 * Delete carrier zone
 */
export async function deleteCarrierZone(
  zoneId: string,
  storeId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('carrier_zones')
    .delete()
    .eq('id', zoneId)
    .eq('store_id', storeId);

  if (error) throw error;
}

// ============================================================
// DASHBOARD / ANALYTICS
// ============================================================

/**
 * Get settlements summary for dashboard
 */
export async function getSettlementsSummary(
  storeId: string,
  startDate?: string,
  endDate?: string
): Promise<{
  total_settlements: number;
  total_pending: number;
  total_paid: number;
  total_cod_collected: number;
  total_carrier_fees: number;
  total_net_receivable: number;
  total_balance_due: number;
}> {
  let query = supabaseAdmin
    .from('daily_settlements')
    .select('*')
    .eq('store_id', storeId);

  if (startDate) {
    query = query.gte('settlement_date', startDate);
  }
  if (endDate) {
    query = query.lte('settlement_date', endDate);
  }

  const { data, error } = await query;

  if (error) throw error;

  const settlements = data || [];

  return {
    total_settlements: settlements.length,
    total_pending: settlements.filter(s => s.status === 'pending').length,
    total_paid: settlements.filter(s => s.status === 'paid').length,
    total_cod_collected: settlements.reduce((sum, s) => sum + (s.total_cod_collected || 0), 0),
    total_carrier_fees: settlements.reduce((sum, s) => sum + (s.total_carrier_fees || 0), 0),
    total_net_receivable: settlements.reduce((sum, s) => sum + (s.net_receivable || 0), 0),
    total_balance_due: settlements.reduce((sum, s) => sum + (s.balance_due || 0), 0)
  };
}

/**
 * Get pending balance by carrier
 */
export async function getPendingByCarrier(
  storeId: string
): Promise<Array<{
  carrier_id: string;
  carrier_name: string;
  pending_settlements: number;
  total_balance_due: number;
}>> {
  const { data, error } = await supabaseAdmin
    .from('daily_settlements')
    .select(`
      carrier_id,
      balance_due,
      carriers!inner(name)
    `)
    .eq('store_id', storeId)
    .in('status', ['pending', 'partial']);

  if (error) throw error;

  // Group by carrier
  const carrierMap = new Map<string, { name: string; count: number; balance: number }>();

  (data || []).forEach((s: any) => {
    const existing = carrierMap.get(s.carrier_id) || {
      name: s.carriers?.name || '',
      count: 0,
      balance: 0
    };
    existing.count++;
    existing.balance += s.balance_due || 0;
    carrierMap.set(s.carrier_id, existing);
  });

  return Array.from(carrierMap.entries()).map(([carrierId, data]) => ({
    carrier_id: carrierId,
    carrier_name: data.name,
    pending_settlements: data.count,
    total_balance_due: data.balance
  }));
}

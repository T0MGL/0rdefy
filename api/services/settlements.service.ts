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

// ============================================================
// MANUAL RECONCILIATION (NEW - Without CSV)
// ============================================================

export interface CourierDateGroup {
  carrier_id: string;
  carrier_name: string;
  dispatch_date: string;
  orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    customer_city: string;
    total_price: number;
    cod_amount: number;
    payment_method: string;
    is_cod: boolean;
    shipped_at: string;
  }>;
  total_orders: number;
  total_cod_expected: number;
  total_prepaid: number;
}

/**
 * Get shipped orders grouped by carrier and dispatch date
 */
export async function getShippedOrdersGrouped(
  storeId: string
): Promise<CourierDateGroup[]> {
  console.log('📦 [SETTLEMENTS] getShippedOrdersGrouped called for store:', storeId);

  try {
    // First get shipped orders
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        order_number,
        shopify_order_name,
        shopify_order_number,
        customer_first_name,
        customer_last_name,
        customer_phone,
        shipping_address,
        shipping_city,
        shipping_reference,
        total_price,
        payment_method,
        payment_status,
        courier_id,
        shipped_at,
        created_at
      `)
      .eq('store_id', storeId)
      .eq('sleeves_status', 'shipped')
      .not('courier_id', 'is', null)
      .order('shipped_at', { ascending: false });

    if (error) {
      console.error('❌ [SETTLEMENTS] Error fetching shipped orders:', error);
      // Return empty array instead of throwing - no shipped orders is a valid state
      return [];
    }

    console.log('📦 [SETTLEMENTS] Found', orders?.length || 0, 'shipped orders');

    if (!orders || orders.length === 0) {
      console.log('📦 [SETTLEMENTS] No shipped orders found, returning empty array');
      return [];
    }

    // Get unique carrier IDs and fetch carrier names separately
    const carrierIdSet = new Set<string>();
    orders.forEach(o => {
      if (o.courier_id) carrierIdSet.add(o.courier_id);
    });
    const carrierIds = Array.from(carrierIdSet);

    if (carrierIds.length === 0) {
      console.log('📦 [SETTLEMENTS] No carrier IDs found, returning empty array');
      return [];
    }

    const { data: carriers, error: carriersError } = await supabaseAdmin
      .from('carriers')
      .select('id, name')
      .in('id', carrierIds);

    if (carriersError) {
      console.error('⚠️ [SETTLEMENTS] Error fetching carriers:', carriersError);
      // Continue with empty carrier map - orders will show "Sin courier"
    }

    // Create carrier lookup map
    const carrierMap = new Map<string, string>();
    carriers?.forEach(c => carrierMap.set(c.id, c.name));

    console.log('📦 [SETTLEMENTS] Loaded', carrierMap.size, 'carriers');

    const groupMap = new Map<string, CourierDateGroup>();

    orders.forEach((order: any) => {
      const dispatchDate = order.shipped_at
        ? new Date(order.shipped_at).toISOString().split('T')[0]
        : new Date(order.created_at).toISOString().split('T')[0];

      const groupKey = `${order.courier_id}_${dispatchDate}`;
      const carrierName = carrierMap.get(order.courier_id) || 'Sin courier';
      const isCod = isCodPayment(order.payment_method);
      const codAmount = isCod ? (order.total_price || 0) : 0;

      // Determine display order number:
      // 1. Shopify order name (#1315 format) - preferred for Shopify orders
      // 2. Shopify order number (numeric) - fallback for Shopify
      // 3. Ordefy format (ORD-XXXXXXXX) - for manual orders
      let displayOrderNumber: string;
      if (order.shopify_order_name) {
        displayOrderNumber = order.shopify_order_name;
      } else if (order.shopify_order_number) {
        displayOrderNumber = `#${order.shopify_order_number}`;
      } else {
        displayOrderNumber = `ORD-${order.id.slice(0, 8).toUpperCase()}`;
      }

      const orderData = {
        id: order.id,
        order_number: displayOrderNumber,
        customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
        customer_phone: order.customer_phone || '',
        customer_address: [order.shipping_address, order.shipping_reference].filter(Boolean).join(', '),
        customer_city: order.shipping_city || '',
        total_price: order.total_price || 0,
        cod_amount: codAmount,
        payment_method: order.payment_method || '',
        is_cod: isCod,
        shipped_at: order.shipped_at || order.created_at,
      };

      if (groupMap.has(groupKey)) {
        const group = groupMap.get(groupKey)!;
        group.orders.push(orderData);
        group.total_orders++;
        if (isCod) {
          group.total_cod_expected += codAmount;
        } else {
          group.total_prepaid++;
        }
      } else {
        groupMap.set(groupKey, {
          carrier_id: order.courier_id,
          carrier_name: carrierName,
          dispatch_date: dispatchDate,
          orders: [orderData],
          total_orders: 1,
          total_cod_expected: isCod ? codAmount : 0,
          total_prepaid: isCod ? 0 : 1,
        });
      }
    });

    console.log('📦 [SETTLEMENTS] Grouped into', groupMap.size, 'carrier/date groups');

    return Array.from(groupMap.values()).sort((a, b) =>
      new Date(b.dispatch_date).getTime() - new Date(a.dispatch_date).getTime()
    );
  } catch (err: any) {
    console.error('💥 [SETTLEMENTS] Unexpected error in getShippedOrdersGrouped:', err);
    // Return empty array on any error - prevents 500 errors
    return [];
  }
}

export interface ManualReconciliationData {
  carrier_id: string;
  dispatch_date: string;
  orders: Array<{
    order_id: string;
    delivered: boolean;
    failure_reason?: string;
    notes?: string;
  }>;
  total_amount_collected: number;
  discrepancy_notes?: string;
  confirm_discrepancy: boolean;
}

/**
 * Process manual reconciliation without CSV
 *
 * CRITICAL FUNCTION - Handles money calculations
 *
 * Validations:
 * 1. All orders must exist in database
 * 2. All orders must be in 'shipped' status (not already delivered/cancelled)
 * 3. All non-delivered orders must have failure_reason
 * 4. total_amount_collected must be >= 0
 * 5. carrier_id must be valid
 *
 * Process:
 * 1. Validate all inputs
 * 2. Calculate statistics (delivered, failed, COD expected, fees)
 * 3. Update order statuses (delivered -> 'delivered', failed -> 'ready_to_ship')
 * 4. Handle discrepancies if any
 * 5. Create settlement record
 */
export async function processManualReconciliation(
  storeId: string,
  userId: string,
  data: ManualReconciliationData
): Promise<DailySettlement> {
  const { carrier_id, dispatch_date, orders, total_amount_collected, discrepancy_notes, confirm_discrepancy } = data;

  // ============================================================
  // VALIDATION PHASE
  // ============================================================

  // Validate inputs
  if (!carrier_id || typeof carrier_id !== 'string') {
    throw new Error('carrier_id es requerido y debe ser un string válido');
  }

  if (!dispatch_date || typeof dispatch_date !== 'string') {
    throw new Error('dispatch_date es requerido');
  }

  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    throw new Error('Debe haber al menos un pedido para conciliar');
  }

  if (typeof total_amount_collected !== 'number' || isNaN(total_amount_collected)) {
    throw new Error('total_amount_collected debe ser un número válido');
  }

  if (total_amount_collected < 0) {
    throw new Error('total_amount_collected no puede ser negativo');
  }

  // Validate carrier exists
  const { data: carrier, error: carrierError } = await supabaseAdmin
    .from('carriers')
    .select('id, name')
    .eq('id', carrier_id)
    .single();

  if (carrierError || !carrier) {
    throw new Error(`Courier no encontrado: ${carrier_id}`);
  }

  // Validate all non-delivered orders have failure_reason
  const invalidOrders = orders.filter(o => !o.delivered && !o.failure_reason);
  if (invalidOrders.length > 0) {
    const orderIds = invalidOrders.map(o => o.order_id.slice(0, 8)).join(', ');
    throw new Error(`${invalidOrders.length} pedido(s) no entregados sin motivo de falla: ${orderIds}`);
  }

  // Get carrier zones for rate calculation
  const { data: zones } = await supabaseAdmin
    .from('carrier_zones')
    .select('*')
    .eq('carrier_id', carrier_id)
    .eq('is_active', true);

  const defaultRate = zones?.find(z => z.zone_name.toLowerCase() === 'default')?.rate || 25000;
  const zoneMap = new Map<string, number>();
  (zones || []).forEach(z => {
    zoneMap.set(z.zone_name.toLowerCase(), z.rate);
  });

  // Get all orders from database and validate
  const orderIds = orders.map(o => o.order_id);
  const { data: dbOrders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select('*')
    .in('id', orderIds)
    .eq('store_id', storeId);

  if (ordersError) {
    console.error('❌ [RECONCILIATION] Error fetching orders:', ordersError);
    throw new Error('Error al obtener los pedidos de la base de datos');
  }

  if (!dbOrders || dbOrders.length === 0) {
    throw new Error('No se encontraron los pedidos especificados en la base de datos');
  }

  // CRITICAL: Validate ALL orders were found
  if (dbOrders.length !== orders.length) {
    const foundIds = new Set(dbOrders.map(o => o.id));
    const missingIds = orderIds.filter(id => !foundIds.has(id));
    throw new Error(`${missingIds.length} pedido(s) no encontrados: ${missingIds.map(id => id.slice(0, 8)).join(', ')}`);
  }

  // CRITICAL: Validate all orders are in 'shipped' status (in transit)
  // Only shipped orders can be reconciled - they're with the courier
  // delivered orders are already completed, cancelled/returned are not valid
  const invalidStatusOrders = dbOrders.filter(o => o.sleeves_status !== 'shipped');
  if (invalidStatusOrders.length > 0) {
    const details = invalidStatusOrders.map(o => `${o.order_number || o.id.slice(0, 8)} (${o.sleeves_status})`).join(', ');
    throw new Error(`${invalidStatusOrders.length} pedido(s) no están en estado 'shipped' (en tránsito): ${details}. Solo se pueden conciliar pedidos despachados.`);
  }

  // CRITICAL: Validate all orders belong to the specified carrier
  const wrongCarrierOrders = dbOrders.filter(o => o.courier_id !== carrier_id);
  if (wrongCarrierOrders.length > 0) {
    throw new Error(`${wrongCarrierOrders.length} pedido(s) no pertenecen al courier seleccionado`);
  }

  console.log(`📝 [RECONCILIATION] Starting reconciliation for ${orders.length} orders, carrier: ${carrier.name}`);

  // ============================================================
  // CALCULATION PHASE
  // ============================================================

  const stats = {
    total_dispatched: orders.length,
    total_delivered: 0,
    total_not_delivered: 0,
    total_cod_delivered: 0,
    total_prepaid_delivered: 0,
    total_cod_collected: 0,
    total_cod_expected: 0,
    total_carrier_fees: 0,
    failed_attempt_fee: 0,
  };

  // Create a map for quick lookup
  const orderInputMap = new Map(orders.map(o => [o.order_id, o]));
  const updatesDelivered: Array<{ id: string; delivered_at: string }> = [];
  const updatesFailed: Array<{ id: string; failure_reason: string; notes: string | null }> = [];
  const codDeliveredOrders: Array<{ id: string; expected: number }> = [];

  for (const dbOrder of dbOrders) {
    const orderInput = orderInputMap.get(dbOrder.id);
    if (!orderInput) {
      // This should never happen due to validation above, but be safe
      console.error(`❌ [RECONCILIATION] Order input not found for ${dbOrder.id}`);
      continue;
    }

    const isCod = isCodPayment(dbOrder.payment_method);
    const city = (dbOrder.shipping_city || '').toLowerCase().trim();
    const carrierFee = zoneMap.get(city) || defaultRate;

    if (orderInput.delivered) {
      // Order was delivered successfully
      stats.total_delivered++;
      stats.total_carrier_fees += carrierFee;

      if (isCod) {
        stats.total_cod_delivered++;
        const orderAmount = dbOrder.total_price || 0;
        stats.total_cod_expected += orderAmount;
        codDeliveredOrders.push({ id: dbOrder.id, expected: orderAmount });
      } else {
        stats.total_prepaid_delivered++;
      }

      // Update to delivered status (all orders here are 'shipped')
      updatesDelivered.push({
        id: dbOrder.id,
        delivered_at: new Date().toISOString(),
      });
    } else {
      // Order delivery failed - return to ready_to_ship for re-dispatch
      stats.total_not_delivered++;
      stats.failed_attempt_fee += carrierFee * 0.5;

      updatesFailed.push({
        id: dbOrder.id,
        failure_reason: orderInput.failure_reason || 'other',
        notes: orderInput.notes || null,
      });
    }
  }

  stats.total_cod_collected = total_amount_collected;

  // Calculate discrepancy
  const discrepancyAmount = total_amount_collected - stats.total_cod_expected;
  const hasDiscrepancy = Math.abs(discrepancyAmount) > 0.01; // Use tolerance for floating point

  // If there's discrepancy but not confirmed, throw error
  if (hasDiscrepancy && !confirm_discrepancy) {
    throw new Error(`Hay una discrepancia de ${discrepancyAmount.toLocaleString()} Gs que no ha sido confirmada`);
  }

  console.log(`📊 [RECONCILIATION] Stats calculated:`, {
    delivered: stats.total_delivered,
    not_delivered: stats.total_not_delivered,
    cod_expected: stats.total_cod_expected,
    cod_collected: stats.total_cod_collected,
    discrepancy: discrepancyAmount,
    carrier_fees: stats.total_carrier_fees,
    failed_fees: stats.failed_attempt_fee,
  });

  // ============================================================
  // UPDATE PHASE
  // ============================================================

  const errors: string[] = [];

  // Update delivered orders
  for (const update of updatesDelivered) {
    const { error } = await supabaseAdmin
      .from('orders')
      .update({
        sleeves_status: 'delivered',
        delivered_at: update.delivered_at,
      })
      .eq('id', update.id)
      .eq('store_id', storeId); // Extra safety

    if (error) {
      console.error(`❌ [RECONCILIATION] Error updating order ${update.id}:`, error);
      errors.push(`Error actualizando pedido ${update.id}: ${error.message}`);
    }
  }

  // Update failed orders
  for (const update of updatesFailed) {
    const { error } = await supabaseAdmin
      .from('orders')
      .update({
        sleeves_status: 'ready_to_ship',
        delivery_notes: update.notes,
        // Store failure reason in delivery_notes or a specific field if available
      })
      .eq('id', update.id)
      .eq('store_id', storeId);

    if (error) {
      console.error(`❌ [RECONCILIATION] Error updating failed order ${update.id}:`, error);
      errors.push(`Error actualizando pedido fallido ${update.id}: ${error.message}`);
    }
  }

  // Handle discrepancy - mark COD orders with amount_collected
  if (hasDiscrepancy && codDeliveredOrders.length > 0) {
    // Distribute discrepancy proportionally across COD orders
    const discrepancyPerOrder = discrepancyAmount / codDeliveredOrders.length;

    for (const codOrder of codDeliveredOrders) {
      const collectedAmount = codOrder.expected + discrepancyPerOrder;

      const { error } = await supabaseAdmin
        .from('orders')
        .update({
          amount_collected: Math.round(collectedAmount * 100) / 100, // Round to 2 decimals
          has_amount_discrepancy: true,
        })
        .eq('id', codOrder.id)
        .eq('store_id', storeId);

      if (error) {
        console.error(`❌ [RECONCILIATION] Error updating discrepancy for ${codOrder.id}:`, error);
        errors.push(`Error marcando discrepancia en pedido ${codOrder.id}`);
      }
    }
  }

  // If there were errors updating orders, throw
  if (errors.length > 0) {
    throw new Error(`Errores al actualizar pedidos: ${errors.join('; ')}`);
  }

  // ============================================================
  // SETTLEMENT CREATION PHASE
  // ============================================================

  const today = new Date();
  const dateStr = today.toLocaleDateString('es-PY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '');

  // Generate unique settlement code with retry for race conditions
  let settlementCode: string = '';
  let attempts = 0;
  const maxAttempts = 5;
  let codeGenerated = false;

  while (attempts < maxAttempts) {
    const { count } = await supabaseAdmin
      .from('daily_settlements')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('settlement_date', today.toISOString().split('T')[0]);

    const settlementNumber = ((count || 0) + 1 + attempts).toString().padStart(2, '0');
    settlementCode = `LIQ-${dateStr}-${settlementNumber}`;

    // Check if code already exists
    const { data: existing } = await supabaseAdmin
      .from('daily_settlements')
      .select('id')
      .eq('settlement_code', settlementCode)
      .single();

    if (!existing) {
      codeGenerated = true;
      break; // Code is unique
    }

    attempts++;
  }

  if (!codeGenerated) {
    throw new Error('No se pudo generar un código único para la liquidación. Intente nuevamente.');
  }

  // Calculate net receivable
  // Formula: COD collected - carrier fees for delivered - failed attempt fees
  const netReceivable = stats.total_cod_collected - stats.total_carrier_fees - stats.failed_attempt_fee;

  // Build notes with discrepancy info if applicable
  let finalNotes = discrepancy_notes || '';
  if (hasDiscrepancy) {
    const discrepancyInfo = `Discrepancia: ${discrepancyAmount > 0 ? '+' : ''}${discrepancyAmount.toLocaleString()} Gs`;
    finalNotes = finalNotes ? `${finalNotes} | ${discrepancyInfo}` : discrepancyInfo;
  }

  const { data: settlement, error: settlementError } = await supabaseAdmin
    .from('daily_settlements')
    .insert({
      store_id: storeId,
      carrier_id: carrier_id,
      settlement_code: settlementCode!,
      settlement_date: dispatch_date,
      total_dispatched: stats.total_dispatched,
      total_delivered: stats.total_delivered,
      total_not_delivered: stats.total_not_delivered,
      total_cod_delivered: stats.total_cod_delivered,
      total_prepaid_delivered: stats.total_prepaid_delivered,
      total_cod_collected: stats.total_cod_collected,
      total_cod_expected: stats.total_cod_expected,
      total_carrier_fees: stats.total_carrier_fees,
      failed_attempt_fee: stats.failed_attempt_fee,
      net_receivable: Math.round(netReceivable * 100) / 100,
      balance_due: Math.round(netReceivable * 100) / 100,
      amount_paid: 0,
      status: 'pending',
      notes: finalNotes || null,
      created_by: userId
    })
    .select(`*, carriers!inner(name)`)
    .single();

  if (settlementError) {
    console.error('❌ [RECONCILIATION] Error creating settlement:', settlementError);
    throw new Error(`Error al crear la liquidación: ${settlementError.message}`);
  }

  console.log(`✅ [RECONCILIATION] Settlement created: ${settlementCode}`, {
    delivered: stats.total_delivered,
    failed: stats.total_not_delivered,
    cod_collected: stats.total_cod_collected,
    net_receivable: netReceivable,
  });

  return {
    ...settlement,
    carrier_name: settlement.carriers?.name,
    carriers: undefined,
  };
}

// ============================================================
// EXCEL EXPORT WITH PROFESSIONAL STYLING
// ============================================================

import ExcelJS from 'exceljs';

/**
 * Export dispatch session as professional Excel file
 */
export async function exportDispatchExcel(
  sessionId: string,
  storeId: string
): Promise<Buffer> {
  const session = await getDispatchSessionById(sessionId, storeId);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ordefy';
  workbook.created = new Date();

  // SHEET 1: INSTRUCCIONES
  const instructionsSheet = workbook.addWorksheet('Instrucciones', {
    properties: { tabColor: { argb: '3B82F6' } }
  });

  instructionsSheet.mergeCells('A1:F1');
  const titleCell = instructionsSheet.getCell('A1');
  titleCell.value = 'ORDEFY';
  titleCell.font = { size: 28, bold: true, color: { argb: '3B82F6' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  instructionsSheet.getRow(1).height = 45;

  instructionsSheet.mergeCells('A2:F2');
  instructionsSheet.getCell('A2').value = 'Sistema de Gestión de Entregas';
  instructionsSheet.getCell('A2').font = { size: 12, italic: true, color: { argb: '6B7280' } };
  instructionsSheet.getCell('A2').alignment = { horizontal: 'center' };

  instructionsSheet.mergeCells('A4:F4');
  const instrHeader = instructionsSheet.getCell('A4');
  instrHeader.value = 'INSTRUCCIONES PARA EL COURIER';
  instrHeader.font = { size: 16, bold: true };
  instrHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };

  const instructions = [
    '',
    '1. Complete la columna "ESTADO_ENTREGA" con:',
    '   • ENTREGADO - Pedido entregado exitosamente',
    '   • NO ENTREGADO - No se pudo entregar',
    '   • RECHAZADO - El cliente rechazó el pedido',
    '',
    '2. Para pedidos COD: Complete "MONTO_COBRADO"',
    '',
    '3. Para NO ENTREGADOS: Complete "MOTIVO_NO_ENTREGA"',
    '',
    '4. TIPO_PAGO: COD = Cobrar, PREPAGO = Ya pagado',
  ];

  instructions.forEach((text, index) => {
    instructionsSheet.getRow(5 + index).getCell(1).value = text;
  });

  instructionsSheet.getColumn(1).width = 60;

  // SHEET 2: PEDIDOS
  const ordersSheet = workbook.addWorksheet('Pedidos', {
    properties: { tabColor: { argb: '10B981' } }
  });

  ordersSheet.mergeCells('A1:K1');
  const headerCell = ordersSheet.getCell('A1');
  headerCell.value = `DESPACHO: ${session.session_code}  •  ${session.carrier_name}`;
  headerCell.font = { size: 14, bold: true, color: { argb: 'FFFFFF' } };
  headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '3B82F6' } };
  headerCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ordersSheet.getRow(1).height = 35;

  ordersSheet.mergeCells('A2:K2');
  const summaryCell = ordersSheet.getCell('A2');
  summaryCell.value = `Total: ${session.orders.length} pedidos  •  COD: ${formatCurrencyGs(session.total_cod_expected)}  •  Prepago: ${session.total_prepaid}`;
  summaryCell.font = { size: 11, italic: true };
  summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EBF5FF' } };
  summaryCell.alignment = { horizontal: 'center' };

  const headers = ['N° PEDIDO', 'CLIENTE', 'TELÉFONO', 'DIRECCIÓN', 'CIUDAD', 'TIPO_PAGO', 'A_COBRAR', 'ESTADO_ENTREGA', 'MONTO_COBRADO', 'MOTIVO_NO_ENTREGA', 'OBSERVACIONES'];

  const headerRow = ordersSheet.getRow(4);
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F2937' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };
  });
  headerRow.height = 25;

  session.orders.forEach((order, index) => {
    const paymentType = order.is_cod ? 'COD' : 'PREPAGO';
    const amountToCollect = getAmountToCollect(order.payment_method, order.total_price);

    const row = ordersSheet.getRow(5 + index);
    const rowData = [
      order.order_number, order.customer_name, order.customer_phone,
      order.delivery_address, order.delivery_city, paymentType,
      amountToCollect, '', '', '', '',
    ];

    rowData.forEach((value, colIndex) => {
      const cell = row.getCell(colIndex + 1);
      cell.value = value;
      cell.font = { size: 10 };
      cell.alignment = { vertical: 'middle' };

      const fillColor = order.is_cod ? { argb: 'DCFCE7' } : { argb: 'DBEAFE' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: fillColor };
      cell.border = {
        top: { style: 'thin', color: { argb: 'D1D5DB' } },
        left: { style: 'thin', color: { argb: 'D1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'D1D5DB' } },
        right: { style: 'thin', color: { argb: 'D1D5DB' } },
      };
    });

    row.getCell(7).numFmt = '#,##0';
    row.getCell(9).numFmt = '#,##0';
  });

  ordersSheet.columns = [
    { width: 14 }, { width: 22 }, { width: 14 }, { width: 35 }, { width: 14 },
    { width: 10 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 18 }, { width: 25 },
  ];

  const lastDataRow = 4 + session.orders.length;

  // Add dropdown validation for ESTADO_ENTREGA column
  for (let i = 5; i <= lastDataRow; i++) {
    ordersSheet.getCell(`H${i}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"ENTREGADO,NO ENTREGADO,RECHAZADO"'],
    };
  }

  // Add dropdown validation for MOTIVO_NO_ENTREGA column
  for (let i = 5; i <= lastDataRow; i++) {
    ordersSheet.getCell(`J${i}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"No contesta,Ausente,Dirección incorrecta,Sin fondos,Rechazado,Otro"'],
    };
  }

  ordersSheet.headerFooter.oddFooter = '&C&"Calibri,Italic"&8Generado por Ordefy - ordefy.io&R&P de &N';

  ordersSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, topLeftCell: 'A5', activeCell: 'H5' }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function formatCurrencyGs(amount: number): string {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Gs';
}

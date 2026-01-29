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
import { generateDispatchExcel, DispatchOrder } from '../utils/excel-export';
import { getTodayInTimezone } from '../utils/dateUtils';
import {
  isCodPayment,
  normalizePaymentMethod,
  getPaymentTypeLabel,
  getAmountToCollect,
  validateAmountCollected
} from '../utils/payment';
import { isValidUUID } from '../utils/sanitize';
import { logger } from '../utils/logger';

/**
 * Normalize city text for comparison: remove accents, lowercase, trim.
 * Matches the behavior of DB function normalize_location_text().
 */
function normalizeCityText(text: string | null | undefined): string {
  if (!text) return '';
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

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
  // Carrier fee configuration
  failed_attempt_fee_percent?: number;
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
// ATOMIC CODE GENERATION HELPERS
// ============================================================
// These functions use RPC calls with advisory locks to prevent
// race conditions when generating settlement/dispatch codes.
// They include retry logic for constraint violations.

const MAX_CODE_GENERATION_RETRIES = 3;

/**
 * Generate settlement code atomically using database RPC
 * Includes retry logic for constraint violations
 */
async function generateSettlementCodeWithRetry(storeId: string): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_CODE_GENERATION_RETRIES; attempt++) {
    try {
      const { data, error } = await supabaseAdmin
        .rpc('generate_settlement_code_atomic', { p_store_id: storeId });

      if (error) {
        // Check if it's a constraint violation (23505 = unique_violation)
        if (error.code === '23505') {
          logger.warn('SETTLEMENTS', `Code collision on attempt ${attempt}, retrying...`);
          lastError = new Error(error.message);
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 100 * attempt));
          continue;
        }
        throw new Error(`Error generando código de liquidación: ${error.message}`);
      }

      if (!data) {
        throw new Error('No se recibió código de liquidación del servidor');
      }

      logger.info('SETTLEMENTS', `Generated code: ${data} (attempt ${attempt})`);
      return data as string;
    } catch (err: any) {
      lastError = err;
      // Only retry on constraint violations
      if (!err.message?.includes('unique') && !err.message?.includes('duplicate')) {
        throw err;
      }
      logger.warn('SETTLEMENTS', `Error on attempt ${attempt}`, { error: err.message });
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }

  throw lastError || new Error('No se pudo generar un código único de liquidación después de varios intentos');
}

/**
 * Generate dispatch session code atomically using database RPC
 * Includes retry logic for constraint violations
 */
async function generateDispatchCodeWithRetry(storeId: string): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_CODE_GENERATION_RETRIES; attempt++) {
    try {
      const { data, error } = await supabaseAdmin
        .rpc('generate_dispatch_code_atomic', { p_store_id: storeId });

      if (error) {
        // Check if it's a constraint violation (23505 = unique_violation)
        if (error.code === '23505') {
          logger.warn('SETTLEMENTS', `[DISPATCH] Code collision on attempt ${attempt}, retrying...`);
          lastError = new Error(error.message);
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 100 * attempt));
          continue;
        }
        throw new Error(`Error generando código de despacho: ${error.message}`);
      }

      if (!data) {
        throw new Error('No se recibió código de despacho del servidor');
      }

      logger.info('SETTLEMENTS', `[DISPATCH] Generated code: ${data} (attempt ${attempt})`);
      return data as string;
    } catch (err: any) {
      lastError = err;
      // Only retry on constraint violations
      if (!err.message?.includes('unique') && !err.message?.includes('duplicate')) {
        throw err;
      }
      logger.warn('SETTLEMENTS', `[DISPATCH] Error on attempt ${attempt}`, { error: err.message });
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }

  throw lastError || new Error('No se pudo generar un código único de despacho después de varios intentos');
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

  // Get order IDs already in ACTIVE dispatch sessions (exclude cancelled/settled)
  const { data: dispatchedOrders } = await supabaseAdmin
    .from('dispatch_session_orders')
    .select(`
      order_id,
      dispatch_sessions!inner(status)
    `)
    .in('order_id', (orders || []).map(o => o.id))
    .not('dispatch_sessions.status', 'in', '("cancelled","settled")');

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
  // Get session with carrier info including failed_attempt_fee_percent
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('dispatch_sessions')
    .select(`
      *,
      carriers!inner(name, failed_attempt_fee_percent)
    `)
    .eq('id', sessionId)
    .eq('store_id', storeId)
    .single();

  if (sessionError) throw sessionError;
  if (!session) throw new Error('Sesión de despacho no encontrada');

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
    // Default to 50% if not set (backwards compatibility)
    failed_attempt_fee_percent: session.carriers?.failed_attempt_fee_percent ?? 50,
    carriers: undefined,
    orders: orders || []
  };
}

/**
 * Create a new dispatch session with orders
 *
 * VALIDATIONS:
 * 1. Orders must exist in the store
 * 2. Orders must NOT be in another active dispatch session
 * 3. Carrier must have at least one zone configured (warning if not)
 * 4. Orders should be in ready_to_ship status (warning if not)
 */
export async function createDispatchSession(
  storeId: string,
  carrierId: string,
  orderIds: string[],
  userId: string
): Promise<DispatchSession> {
  // ============================================================
  // VALIDATION 1: Check for orders already in active sessions
  // ============================================================
  const { data: duplicateOrders } = await supabaseAdmin
    .from('dispatch_session_orders')
    .select(`
      order_id,
      dispatch_sessions!inner(session_code, status)
    `)
    .in('order_id', orderIds)
    .not('dispatch_sessions.status', 'in', '("cancelled","settled")');

  if (duplicateOrders && duplicateOrders.length > 0) {
    const duplicateIds = duplicateOrders.map((d: any) =>
      `${d.order_id.slice(0, 8)} (${d.dispatch_sessions.session_code})`
    ).join(', ');
    throw new Error(`${duplicateOrders.length} orden(es) ya están en sesiones activas: ${duplicateIds}`);
  }

  // Generate session code atomically using RPC (prevents race conditions)
  const today = new Date();
  const sessionCode = await generateDispatchCodeWithRetry(storeId);

  // ============================================================
  // VALIDATION 2: Get carrier zones and coverage (BLOCKING)
  // ============================================================
  const { data: zones } = await supabaseAdmin
    .from('carrier_zones')
    .select('*')
    .eq('carrier_id', carrierId)
    .eq('is_active', true);

  // Also get city-based coverage (new system - migration 090)
  const { data: coverage } = await supabaseAdmin
    .from('carrier_coverage')
    .select('city, rate')
    .eq('carrier_id', carrierId)
    .eq('is_active', true);

  // Build coverage map from new system (city -> rate)
  const coverageMap = new Map<string, number>();
  (coverage || []).forEach(c => {
    if (c.city && c.rate != null) {
      coverageMap.set(normalizeCityText(c.city), c.rate);
    }
  });

  const zoneMap = new Map<string, number>();
  let hasDefaultZone = false;
  const defaultZoneNames = ['default', 'otros', 'interior', 'general'];

  // IMPORTANT: Normalize zone names to strip accents (e.g., "Asunción" → "asuncion")
  (zones || []).forEach(z => {
    const zoneNormalized = normalizeCityText(z.zone_name);
    zoneMap.set(zoneNormalized, z.rate);
    if (defaultZoneNames.includes(zoneNormalized)) {
      hasDefaultZone = true;
    }
  });

  // BLOCKING: Carrier must have at least one zone or coverage entry configured
  if ((!zones || zones.length === 0) && (!coverage || coverage.length === 0)) {
    // Get carrier name for better error message
    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('name')
      .eq('id', carrierId)
      .single();

    const carrierName = carrier?.name || carrierId.slice(0, 8);
    throw new Error(
      `El carrier "${carrierName}" no tiene zonas ni cobertura configuradas. ` +
      `Configure al menos una zona/cobertura con tarifas antes de despachar. ` +
      `Vaya a Configuración > Carriers > Zonas para agregar zonas.`
    );
  }

  // Warning if no default zone (but allow dispatch)
  if (!hasDefaultZone) {
    logger.warn('SETTLEMENTS', `[DISPATCH] Carrier ${carrierId} has no fallback zone (default/otros/interior/general). Orders to unconfigured cities will have 0 fees.`);
  }

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
    throw new Error('No se encontraron las órdenes especificadas');
  }

  // ============================================================
  // VALIDATION 3: Verify all orders were found
  // ============================================================
  if (orders.length !== orderIds.length) {
    const foundIds = new Set(orders.map(o => o.id));
    const missingIds = orderIds.filter(id => !foundIds.has(id));
    throw new Error(`${missingIds.length} orden(es) no encontradas: ${missingIds.map(id => id.slice(0, 8)).join(', ')}`);
  }

  // ============================================================
  // VALIDATION 4: Block pickup orders (no shipping needed)
  // ============================================================
  const pickupOrders = orders.filter(o => o.is_pickup === true || (!o.courier_id && o.sleeves_status !== 'pending'));

  if (pickupOrders.length > 0) {
    const details = pickupOrders.map(o =>
      o.order_number || o.shopify_order_name || o.id.slice(0, 8)
    ).join(', ');
    throw new Error(
      `${pickupOrders.length} orden(es) son de retiro en local y no pueden despacharse: ${details}. ` +
      `Las órdenes de retiro no requieren transportadora.`
    );
  }

  // ============================================================
  // VALIDATION 5: Check order statuses (warn if not ready_to_ship)
  // ============================================================
  const invalidStatusOrders = orders.filter(o =>
    !['ready_to_ship', 'confirmed'].includes(o.sleeves_status)
  );

  if (invalidStatusOrders.length > 0) {
    const details = invalidStatusOrders.map(o =>
      `${o.order_number || o.id.slice(0, 8)} (${o.sleeves_status})`
    ).join(', ');
    logger.warn('SETTLEMENTS', `[DISPATCH] ${invalidStatusOrders.length} orden(es) con estado inesperado: ${details}`);
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
    // Calculate fee: coverage (city) → zone (delivery_zone) → zone (shipping_city) → fallback zones → 0
    const normalizedCity = order.shipping_city_normalized || normalizeCityText(order.shipping_city);
    const normalizedZone = normalizeCityText(order.delivery_zone);

    let rate: number | undefined;

    if (normalizedCity && coverageMap.has(normalizedCity)) {
      rate = coverageMap.get(normalizedCity);
    } else if (normalizedZone && zoneMap.has(normalizedZone)) {
      rate = zoneMap.get(normalizedZone);
    } else if (normalizedCity && zoneMap.has(normalizedCity)) {
      // Fallback: check shipping_city against zone names (for carriers that use city names as zone_names)
      rate = zoneMap.get(normalizedCity);
    } else {
      // Try fallback zones in priority order
      for (const fallback of defaultZoneNames) {
        if (zoneMap.has(fallback)) {
          rate = zoneMap.get(fallback);
          break;
        }
      }
    }
    rate = rate || 0;

    // Check if already paid online (financial_status from Shopify)
    const financialStatus = (order.financial_status || '').toLowerCase();
    const isPaidOnline = financialStatus === 'paid' || financialStatus === 'authorized';

    // Use centralized payment utilities for COD determination
    // NOT COD if: financial_status is 'paid' (Shopify prepaid) OR prepaid_method is set (marked as prepaid in Ordefy)
    const isCod = !isPaidOnline && !order.prepaid_method && isCodPayment(order.payment_method);
    const normalizedMethod = normalizePaymentMethod(order.payment_method);

    if (isCod) {
      totalCodExpected += order.total_price || 0;
    } else {
      totalPrepaid += order.total_price || 0;
      totalPrepaidCarrierFees += rate;
    }

    return {
      dispatch_session_id: session.id,
      order_id: order.id,
      order_number: order.order_number,
      customer_name: order.customers?.name || order.customer_name || '',
      customer_phone: order.customers?.phone || order.customer_phone || '',
      delivery_address: typeof order.shipping_address === 'string' ? order.shipping_address : (order.shipping_address?.address1 || ''),
      delivery_city: order.delivery_zone || '',
      delivery_zone: order.delivery_zone || '',
      total_price: order.total_price || 0,
      payment_method: normalizedMethod,
      is_cod: isCod,
      carrier_fee: rate,
      delivery_status: 'pending'
    };
  });

  logger.info('SETTLEMENTS', `[DISPATCH] Creating session with ${orders.length} orders`, {
    total_cod_orders: sessionOrders.filter(o => o.is_cod).length,
    total_prepaid_orders: sessionOrders.filter(o => !o.is_cod).length,
    total_cod_expected: totalCodExpected,
    total_prepaid: totalPrepaid,
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
 * Export dispatch session as professional Excel file with Ordefy branding
 */
export async function exportDispatchExcel(
  sessionId: string,
  storeId: string
): Promise<Buffer> {
  const session = await getDispatchSessionById(sessionId, storeId);

  const sessionInfo = `Código: ${session.session_code} | Transportadora: ${session.carrier_name} | Fecha: ${new Date().toLocaleDateString('es-PY')}`;

  const orders: DispatchOrder[] = session.orders.map(order => ({
    orderNumber: order.order_number,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    deliveryAddress: order.delivery_address,
    deliveryCity: order.delivery_city,
    paymentType: order.is_cod ? 'COD' : '✓ PAGADO',
    amountToCollect: order.is_cod ? order.total_price : 0,
    carrierFee: order.carrier_fee
  }));

  return generateDispatchExcel(sessionInfo, orders);
}

/**
 * Import delivery results from CSV - ATOMIC VERSION
 *
 * Uses database RPC to ensure all updates happen in a single transaction.
 * If any step fails, the entire operation is rolled back automatically.
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
  logger.info('SETTLEMENTS', `[CSV IMPORT] Starting atomic import for session ${sessionId} with ${results.length} rows`);

  // Transform results to the format expected by the RPC
  const rpcResults = results.map(row => ({
    order_number: row.order_number,
    delivery_status: row.delivery_status || '',
    amount_collected: row.amount_collected ?? null,
    failure_reason: row.failure_reason || null,
    courier_notes: row.courier_notes || null
  }));

  try {
    // Call atomic RPC function
    const { data, error } = await supabaseAdmin.rpc('import_dispatch_results_atomic', {
      p_session_id: sessionId,
      p_store_id: storeId,
      p_results: rpcResults
    });

    if (error) {
      logger.error('SETTLEMENTS', '[CSV IMPORT] Atomic import failed', error);

      // Fallback to non-atomic import if RPC not available
      if (error.message?.includes('function') || error.code === '42883') {
        logger.warn('SETTLEMENTS', '[CSV IMPORT] RPC not available, falling back to legacy import');
        return importDispatchResultsLegacy(sessionId, storeId, results);
      }

      throw new Error(`Error importing results: ${error.message}`);
    }

    const result = data as { processed: number; errors: string[]; warnings: string[] };
    logger.info('SETTLEMENTS', `[CSV IMPORT] Atomic import complete: ${result.processed} processed, ${result.errors.length} errors, ${result.warnings.length} warnings`);

    return result;
  } catch (err: any) {
    // If the error is about the function not existing, fall back to legacy
    if (err.message?.includes('function') || err.message?.includes('does not exist')) {
      logger.warn('SETTLEMENTS', '[CSV IMPORT] RPC not available, falling back to legacy import');
      return importDispatchResultsLegacy(sessionId, storeId, results);
    }
    throw err;
  }
}

/**
 * Legacy non-atomic import function
 * Used as fallback when the atomic RPC is not available
 * @deprecated Use atomic version via RPC when available
 */
async function importDispatchResultsLegacy(
  sessionId: string,
  storeId: string,
  results: ImportRow[]
): Promise<{ processed: number; errors: string[]; warnings: string[] }> {
  const session = await getDispatchSessionById(sessionId, storeId);

  if (session.status === 'settled') {
    throw new Error('La sesión ya fue liquidada');
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

    // CRITICAL: Create carrier account movements for delivered/failed orders
    // This ensures balances are updated in real-time from CSV import
    if (deliveryStatus === 'delivered') {
      // Call SQL function to create movements (COD + delivery fee)
      try {
        const { error: movementError } = await supabaseAdmin.rpc('create_delivery_movements', {
          p_order_id: sessionOrder.order_id,
          p_amount_collected: amountCollected,
          p_dispatch_session_id: sessionId,
          p_created_by: null
        });

        if (movementError) {
          logger.error('SETTLEMENTS', `[CSV IMPORT] Failed to create movements for ${row.order_number}`, movementError);
          warnings.push(`Pedido ${row.order_number} actualizado pero no se pudo registrar en cuentas del transportista`);
        } else {
          logger.info('SETTLEMENTS', `[CSV IMPORT] Created carrier movements for ${row.order_number}`);
        }
      } catch (movementError) {
        logger.error('SETTLEMENTS', `[CSV IMPORT] Exception creating movements for ${row.order_number}`, movementError);
      }
    } else if (['not_delivered', 'rejected', 'returned'].includes(deliveryStatus)) {
      // Create failed attempt fee movement (if carrier charges for failures)
      try {
        const { error: movementError } = await supabaseAdmin.rpc('create_failed_delivery_movement', {
          p_order_id: sessionOrder.order_id,
          p_dispatch_session_id: sessionId,
          p_created_by: null
        });

        if (movementError) {
          logger.error('SETTLEMENTS', `[CSV IMPORT] Failed to create failed movement for ${row.order_number}`, movementError);
        } else {
          logger.info('SETTLEMENTS', `[CSV IMPORT] Created failed attempt fee for ${row.order_number}`);
        }
      } catch (movementError) {
        logger.error('SETTLEMENTS', '[CSV IMPORT] Exception creating failed movement', movementError);
      }
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
 * Process dispatch session and create settlement - ATOMIC VERSION
 *
 * Uses database RPC to ensure all operations happen in a single transaction.
 * If any step fails, the entire operation is rolled back automatically.
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
  logger.info('SETTLEMENTS', `Starting atomic settlement for session ${sessionId}`);

  try {
    // Call atomic RPC function
    const { data, error } = await supabaseAdmin.rpc('process_settlement_atomic_v2', {
      p_session_id: sessionId,
      p_store_id: storeId,
      p_user_id: userId || null
    });

    if (error) {
      logger.error('SETTLEMENTS', 'Atomic settlement failed', error);

      // Fallback to legacy processing if RPC not available
      if (error.message?.includes('function') || error.code === '42883') {
        logger.warn('SETTLEMENTS', 'RPC not available, falling back to legacy processing');
        return processSettlementLegacy(sessionId, storeId, userId);
      }

      throw new Error(`Error processing settlement: ${error.message}`);
    }

    const settlement = data as DailySettlement;
    logger.info('SETTLEMENTS', `Atomic settlement complete: ${settlement.settlement_code}, net_receivable: ${settlement.net_receivable}`);

    return settlement;
  } catch (err: any) {
    // If the error is about the function not existing, fall back to legacy
    if (err.message?.includes('function') || err.message?.includes('does not exist')) {
      logger.warn('SETTLEMENTS', 'RPC not available, falling back to legacy processing');
      return processSettlementLegacy(sessionId, storeId, userId);
    }
    throw err;
  }
}

/**
 * Legacy non-atomic settlement processing
 * Used as fallback when the atomic RPC is not available
 * @deprecated Use atomic version via RPC when available
 */
async function processSettlementLegacy(
  sessionId: string,
  storeId: string,
  userId: string
): Promise<DailySettlement> {
  const session = await getDispatchSessionById(sessionId, storeId);

  if (session.status === 'settled') {
    throw new Error('La sesión ya fue liquidada');
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
          logger.warn('SETTLEMENTS', `Prepaid order ${order.order_number} has amount_collected=${order.amount_collected}. This should be 0.`);
        }
      }
    } else if (['not_delivered', 'rejected', 'returned'].includes(order.delivery_status)) {
      stats.total_not_delivered++;
      // Use carrier's configured failed attempt fee percentage (default 50%)
      const feePercent = (session.failed_attempt_fee_percent ?? 50) / 100;
      stats.failed_attempt_fee += (order.carrier_fee || 0) * feePercent;
    }
  }

  // Generate settlement code atomically using RPC (prevents race conditions)
  const today = new Date();
  const settlementCode = await generateSettlementCodeWithRetry(storeId);

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
  logger.info('SETTLEMENTS', `Session ${session.session_code}`, {
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

  // CRITICAL: Link carrier movements to this settlement
  // This marks movements as "settled" so they don't appear in unsettled balance
  await supabaseAdmin
    .from('carrier_account_movements')
    .update({ settlement_id: settlement.id })
    .eq('dispatch_session_id', sessionId)
    .is('settlement_id', null);

  logger.info('SETTLEMENTS', `Linked carrier movements to settlement ${settlement.id}`);

  // Update order statuses in main orders table (batch update)
  const orderUpdates = session.orders
    .filter(o => o.delivery_status !== 'pending')
    .map(order => {
      let newStatus = order.delivery_status;
      if (order.delivery_status === 'not_delivered') {
        newStatus = 'shipped'; // Keep as shipped for retry
      }
      return {
        id: order.order_id,
        sleeves_status: newStatus,
        delivered_at: order.delivery_status === 'delivered' ? order.delivered_at : null
      };
    });

  // Batch update orders (still sequential but prepared for batch)
  for (const update of orderUpdates) {
    await supabaseAdmin
      .from('orders')
      .update({
        sleeves_status: update.sleeves_status,
        delivered_at: update.delivered_at
      })
      .eq('id', update.id);
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
  if (!settlement) throw new Error('Liquidación no encontrada');

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
 * Uses atomic RPC to prevent race conditions with concurrent payments
 *
 * @param settlementId - UUID of the settlement
 * @param storeId - UUID of the store (for security validation)
 * @param payment - Payment details
 * @returns Updated settlement record
 * @throws Error if validation fails or RPC returns error
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
  // ============================================================
  // Input validation
  // ============================================================
  if (!settlementId || !isValidUUID(settlementId)) {
    throw new Error('Formato de ID de liquidación inválido');
  }

  if (!storeId || !isValidUUID(storeId)) {
    throw new Error('Formato de ID de tienda inválido');
  }

  if (payment.amount === undefined || payment.amount === null) {
    throw new Error('Se requiere el monto del pago');
  }

  if (typeof payment.amount !== 'number' || isNaN(payment.amount)) {
    throw new Error('El monto del pago debe ser un número válido');
  }

  if (payment.amount <= 0) {
    throw new Error('El monto del pago debe ser positivo');
  }

  // Sanitize string inputs
  const sanitizedMethod = payment.method?.trim().substring(0, 50) || null;
  const sanitizedReference = payment.reference?.trim().substring(0, 255) || null;
  const sanitizedNotes = payment.notes?.trim().substring(0, 1000) || null;

  // ============================================================
  // Call atomic RPC
  // ============================================================
  const { data, error } = await supabaseAdmin.rpc('record_settlement_payment', {
    p_settlement_id: settlementId,
    p_amount: payment.amount,
    p_store_id: storeId,
    p_method: sanitizedMethod,
    p_reference: sanitizedReference,
    p_notes: sanitizedNotes
  });

  if (error) {
    logger.error('SETTLEMENTS', 'RPC error in markSettlementPaid', error);
    throw new Error(`Database error: ${error.message}`);
  }

  // ============================================================
  // Handle RPC response
  // ============================================================
  if (!data) {
    throw new Error('Sin respuesta de la función de registro de pago');
  }

  if (!data.success) {
    // Map error codes to user-friendly messages
    const errorCode = data.error_code || 'UNKNOWN';
    const errorMessage = data.error || 'Error al registrar pago';

    switch (errorCode) {
      case 'NOT_FOUND':
        throw new Error('Liquidación no encontrada o acceso denegado');
      case 'ALREADY_PAID':
        throw new Error(`Settlement is already fully paid (${data.current_amount_paid}/${data.net_receivable})`);
      case 'SETTLEMENT_DISPUTED':
        throw new Error('No se puede registrar pago en una liquidación en disputa. Resuelva la disputa primero.');
      case 'SETTLEMENT_CANCELLED':
        throw new Error('No se puede registrar pago en una liquidación cancelada');
      case 'INVALID_AMOUNT':
        throw new Error('El monto del pago debe ser un número positivo');
      case 'INVALID_INPUT':
        throw new Error(errorMessage);
      case 'INTERNAL_ERROR':
        logger.error('SETTLEMENTS', 'Internal RPC error', data);
        throw new Error('Error interno al registrar el pago. Por favor intente nuevamente.');
      default:
        throw new Error(errorMessage);
    }
  }

  logger.info('SETTLEMENTS', `Payment recorded: ${payment.amount} for settlement ${settlementId} (status: ${data.data.status})`);

  // ============================================================
  // Register payment in carrier account movements
  // ============================================================
  // This creates a movement to track the actual money flow
  const settlementData = data.data as DailySettlement;

  if (settlementData.carrier_id) {
    try {
      // Determine payment direction based on net_receivable
      // Positive net_receivable = carrier owes store = payment from carrier
      // Negative net_receivable = store owes carrier = payment to carrier
      const direction: 'from_carrier' | 'to_carrier' =
        (settlementData.net_receivable || 0) >= 0 ? 'from_carrier' : 'to_carrier';

      await registerCarrierPayment(
        storeId,
        settlementData.carrier_id,
        payment.amount,
        direction,
        payment.method,
        {
          paymentReference: payment.reference,
          notes: payment.notes || `Pago de liquidación ${settlementData.settlement_code}`,
          settlementIds: [settlementId],
        }
      );

      logger.info('SETTLEMENTS', `Carrier payment movement created for settlement ${settlementId}`);
    } catch (movementError: any) {
      // Log but don't fail - settlement is already recorded
      logger.warn('SETTLEMENTS', `Warning: Could not create carrier payment movement: ${movementError.message}`);
    }
  }

  return settlementData;
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
  failed_attempt_fee_percent: number;
}

/**
 * Get shipped orders grouped by carrier and dispatch date
 */
export async function getShippedOrdersGrouped(
  storeId: string
): Promise<CourierDateGroup[]> {
  logger.info('SETTLEMENTS', 'getShippedOrdersGrouped called', { storeId });

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
        delivery_zone,
        total_price,
        payment_method,
        prepaid_method,
        payment_status,
        courier_id,
        shipped_at,
        created_at
      `)
      .eq('store_id', storeId)
      .in('sleeves_status', ['shipped', 'in_transit'])
      .not('courier_id', 'is', null)
      .order('shipped_at', { ascending: false });

    if (error) {
      logger.error('SETTLEMENTS', 'Error fetching shipped orders', error);
      // Return empty array instead of throwing - no shipped orders is a valid state
      return [];
    }

    logger.info('SETTLEMENTS', `Found ${orders?.length || 0} shipped/in_transit orders`);

    if (!orders || orders.length === 0) {
      logger.info('SETTLEMENTS', 'No shipped/in_transit orders found, returning empty array');
      return [];
    }

    // Get unique carrier IDs and fetch carrier names separately
    const carrierIdSet = new Set<string>();
    orders.forEach(o => {
      if (o.courier_id) carrierIdSet.add(o.courier_id);
    });
    const carrierIds = Array.from(carrierIdSet);

    if (carrierIds.length === 0) {
      logger.info('SETTLEMENTS', 'No carrier IDs found, returning empty array');
      return [];
    }

    const { data: carriers, error: carriersError } = await supabaseAdmin
      .from('carriers')
      .select('id, name, failed_attempt_fee_percent')
      .in('id', carrierIds);

    if (carriersError) {
      logger.error('SETTLEMENTS', 'Error fetching carriers', carriersError);
      // Continue with empty carrier map - orders will show "Sin courier"
    }

    // Create carrier lookup maps
    const carrierMap = new Map<string, { name: string; failed_attempt_fee_percent: number }>();
    carriers?.forEach(c => carrierMap.set(c.id, {
      name: c.name,
      failed_attempt_fee_percent: c.failed_attempt_fee_percent ?? 50
    }));

    logger.info('SETTLEMENTS', `Loaded ${carrierMap.size} carriers`);

    const groupMap = new Map<string, CourierDateGroup>();

    orders.forEach((order: any) => {
      const dispatchDate = order.shipped_at
        ? new Date(order.shipped_at).toISOString().split('T')[0]
        : new Date(order.created_at).toISOString().split('T')[0];

      const groupKey = `${order.courier_id}_${dispatchDate}`;
      const carrierData = carrierMap.get(order.courier_id) || { name: 'Sin courier', failed_attempt_fee_percent: 50 };
      // IMPORTANT: If prepaid_method is set, it's NOT COD (even if payment_method was 'efectivo')
      const isCod = !order.prepaid_method && isCodPayment(order.payment_method);
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
        customer_address: typeof order.shipping_address === 'string' ? order.shipping_address : (order.shipping_address?.address1 || ''),
        customer_city: order.delivery_zone || '',
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
          carrier_name: carrierData.name,
          dispatch_date: dispatchDate,
          orders: [orderData],
          total_orders: 1,
          total_cod_expected: isCod ? codAmount : 0,
          total_prepaid: isCod ? 0 : 1,
          failed_attempt_fee_percent: carrierData.failed_attempt_fee_percent,
        });
      }
    });

    logger.info('SETTLEMENTS', `Grouped into ${groupMap.size} carrier/date groups`);

    return Array.from(groupMap.values()).sort((a, b) =>
      new Date(b.dispatch_date).getTime() - new Date(a.dispatch_date).getTime()
    );
  } catch (err: any) {
    logger.error('SETTLEMENTS', 'Unexpected error in getShippedOrdersGrouped', err);
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
 * Process manual reconciliation without CSV - ATOMIC VERSION
 *
 * Uses database RPC to ensure all updates happen in a single transaction.
 * If any step fails, the entire operation is rolled back automatically.
 *
 * BUG #5 FIX: This function prevents partial updates and data corruption
 * by executing all operations atomically in the database.
 */
export async function processManualReconciliation(
  storeId: string,
  userId: string,
  data: ManualReconciliationData
): Promise<DailySettlement> {
  logger.info('SETTLEMENTS', `[MANUAL RECONCILIATION] Starting atomic reconciliation for ${data.orders.length} orders`);

  try {
    // Call atomic RPC function
    const { data: result, error } = await supabaseAdmin.rpc('process_manual_reconciliation_atomic', {
      p_store_id: storeId,
      p_user_id: userId,
      p_carrier_id: data.carrier_id,
      p_dispatch_date: data.dispatch_date,
      p_total_amount_collected: data.total_amount_collected,
      p_discrepancy_notes: data.discrepancy_notes || null,
      p_confirm_discrepancy: data.confirm_discrepancy,
      p_orders: data.orders
    });

    if (error) {
      logger.error('SETTLEMENTS', '[MANUAL RECONCILIATION] Atomic reconciliation failed', error);

      // Fallback to legacy non-atomic version if RPC not available
      if (error.message?.includes('function') || error.code === '42883') {
        logger.warn('SETTLEMENTS', '[MANUAL RECONCILIATION] RPC not available, falling back to legacy reconciliation');
        return processManualReconciliationLegacy(storeId, userId, data);
      }

      throw new Error(`Error processing reconciliation: ${error.message}`);
    }

    logger.info('SETTLEMENTS', `[MANUAL RECONCILIATION] Atomic reconciliation complete: ${result.settlement_code}`);

    // Transform RPC result to DailySettlement format
    const settlement: DailySettlement = {
      id: result.id,
      store_id: storeId,
      carrier_id: data.carrier_id,
      dispatch_session_id: null,
      settlement_code: result.settlement_code,
      settlement_date: data.dispatch_date,
      total_dispatched: result.total_dispatched,
      total_delivered: result.total_delivered,
      total_not_delivered: result.total_not_delivered,
      total_cod_delivered: result.total_cod_delivered || 0,
      total_prepaid_delivered: result.total_prepaid_delivered || 0,
      total_cod_collected: result.total_cod_collected,
      total_carrier_fees: result.total_carrier_fees,
      failed_attempt_fee: result.failed_attempt_fee,
      net_receivable: result.net_receivable,
      balance_due: result.net_receivable,
      amount_paid: 0,
      status: 'pending',
      payment_date: null,
      payment_method: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: userId,
      carrier_name: result.carrier_name
    };

    return settlement;
  } catch (err: any) {
    // If the error is about the function not existing, fall back to legacy
    if (err.message?.includes('function') || err.message?.includes('does not exist')) {
      logger.warn('SETTLEMENTS', '[MANUAL RECONCILIATION] RPC not available, falling back to legacy reconciliation');
      return processManualReconciliationLegacy(storeId, userId, data);
    }
    throw err;
  }
}

/**
 * Legacy manual reconciliation function
 * Used as fallback when the atomic RPC is not available
 *
 * @deprecated Use atomic version via RPC when available
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
async function processManualReconciliationLegacy(
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

  // BUG #2 FIX: Validate NaN and Infinity explicitly
  // BUG #6 FIX: Reject Infinity values
  if (typeof total_amount_collected !== 'number' ||
      isNaN(total_amount_collected) ||
      !isFinite(total_amount_collected)) {
    throw new Error('total_amount_collected debe ser un número válido y finito');
  }

  if (total_amount_collected < 0) {
    throw new Error('total_amount_collected no puede ser negativo');
  }

  // Validate carrier exists and get fee configuration
  const { data: carrier, error: carrierError } = await supabaseAdmin
    .from('carriers')
    .select('id, name, failed_attempt_fee_percent')
    .eq('id', carrier_id)
    .single();

  if (carrierError || !carrier) {
    throw new Error(`Courier no encontrado: ${carrier_id}`);
  }

  // Get carrier's failed attempt fee percentage (default 50%)
  const failedAttemptFeePercent = (carrier.failed_attempt_fee_percent ?? 50) / 100;

  // Validate all non-delivered orders have failure_reason
  const invalidOrders = orders.filter(o => !o.delivered && !o.failure_reason);
  if (invalidOrders.length > 0) {
    const orderIds = invalidOrders.map(o => o.order_id.slice(0, 8)).join(', ');
    throw new Error(`${invalidOrders.length} pedido(s) no entregados sin motivo de falla: ${orderIds}`);
  }

  // Get carrier zones for rate calculation (legacy system)
  const { data: zones } = await supabaseAdmin
    .from('carrier_zones')
    .select('*')
    .eq('carrier_id', carrier_id)
    .eq('is_active', true);

  // Get carrier coverage for rate calculation (new city-based system - migration 090)
  const { data: coverage } = await supabaseAdmin
    .from('carrier_coverage')
    .select('city, rate')
    .eq('carrier_id', carrier_id)
    .eq('is_active', true);

  // Build coverage map from new system (city -> rate)
  const coverageMap = new Map<string, number>();
  (coverage || []).forEach(c => {
    if (c.city && c.rate != null) {
      coverageMap.set(normalizeCityText(c.city), c.rate);
    }
  });

  // Find default rate from fallback zones (priority: default > otros > interior > general)
  const fallbackZoneNames = ['default', 'otros', 'interior', 'general'];
  let defaultRate = 25000; // Fallback if no zones at all
  const zoneMap = new Map<string, number>();

  // IMPORTANT: Normalize zone names to strip accents (e.g., "Asunción" → "asuncion")
  (zones || []).forEach(z => {
    const zoneNormalized = normalizeCityText(z.zone_name);
    zoneMap.set(zoneNormalized, z.rate);
  });

  // Find best fallback rate
  for (const fallback of fallbackZoneNames) {
    if (zoneMap.has(fallback)) {
      defaultRate = zoneMap.get(fallback)!;
      break;
    }
  }

  // CRITICAL FIX: Safe array access - validate zones.length before accessing zones[0]
  // If carrier has zones but none matched as default, use first zone's rate
  if (zones && zones.length > 0 && !fallbackZoneNames.some(f => zoneMap.has(f))) {
    defaultRate = zones[0].rate; // Safe: zones.length already validated > 0
    logger.warn('SETTLEMENTS', `[RECONCILIATION] Carrier ${carrier_id} has no fallback zone, using first zone rate: ${defaultRate}`);
  } else if (!zones || zones.length === 0) {
    logger.warn('SETTLEMENTS', `[RECONCILIATION] Carrier ${carrier_id} has NO zones configured, using hardcoded fallback rate: ${defaultRate}`);
  }

  // Log coverage map status for debugging
  if (coverageMap.size > 0) {
    logger.info('SETTLEMENTS', `[RECONCILIATION] Carrier has ${coverageMap.size} city-based coverage entries`);
  }

  // Get all orders from database and validate
  const orderIds = orders.map(o => o.order_id);
  const { data: dbOrders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select('*')
    .in('id', orderIds)
    .eq('store_id', storeId);

  if (ordersError) {
    logger.error('SETTLEMENTS', '[RECONCILIATION] Error fetching orders', ordersError);
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

  logger.info('SETTLEMENTS', `[RECONCILIATION] Starting reconciliation for ${orders.length} orders, carrier: ${carrier.name}`);

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
      logger.error('SETTLEMENTS', `[RECONCILIATION] Order input not found for ${dbOrder.id}`);
      continue;
    }

    // IMPORTANT: If prepaid_method is set, it's NOT COD (even if payment_method was 'efectivo')
    const isCod = !dbOrder.prepaid_method && isCodPayment(dbOrder.payment_method);

    // Calculate fee: coverage (city) → zone (delivery_zone) → zone (shipping_city) → default
    const normalizedCity = dbOrder.shipping_city_normalized || normalizeCityText(dbOrder.shipping_city);
    const normalizedZone = normalizeCityText(dbOrder.delivery_zone);

    let carrierFee = defaultRate;
    if (normalizedCity && coverageMap.has(normalizedCity)) {
      carrierFee = coverageMap.get(normalizedCity)!;
    } else if (normalizedZone && zoneMap.has(normalizedZone)) {
      carrierFee = zoneMap.get(normalizedZone)!;
    } else if (normalizedCity && zoneMap.has(normalizedCity)) {
      // Fallback: check shipping_city against zone names (for carriers that use city names as zone_names)
      carrierFee = zoneMap.get(normalizedCity)!;
    }

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
      // Use carrier's configured failed attempt fee percentage
      stats.failed_attempt_fee += carrierFee * failedAttemptFeePercent;

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
    throw new Error(`Hay una discrepancia de ${discrepancyAmount.toLocaleString()} que no ha sido confirmada`);
  }

  logger.info('SETTLEMENTS', '[RECONCILIATION] Stats calculated', {
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
  // BUG #5 MITIGATION: Ideally all updates should happen in a single transaction
  // TODO: Create process_manual_reconciliation_atomic RPC in database for full atomicity
  // Current approach: Check errors immediately to minimize partial updates

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
      logger.error('SETTLEMENTS', `[RECONCILIATION] Error updating order ${update.id}`, error);
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
      logger.error('SETTLEMENTS', `[RECONCILIATION] Error updating failed order ${update.id}`, error);
      errors.push(`Error actualizando pedido fallido ${update.id}: ${error.message}`);
    }
  }

  // BUG #7 FIX: Check errors BEFORE applying discrepancies
  // If there were errors updating order statuses, STOP before modifying amounts
  if (errors.length > 0) {
    throw new Error(`Errores al actualizar pedidos (se detuvo antes de aplicar discrepancias): ${errors.join('; ')}`);
  }

  // BUG #3 FIX: Validate COD orders exist before distributing discrepancy
  // Handle discrepancy - mark COD orders with amount_collected
  if (hasDiscrepancy && codDeliveredOrders.length > 0) {
    // BUG #1 & #4 FIX: Distribute with proper rounding and validate total
    // Distribute discrepancy evenly, ensuring the sum equals the original discrepancy
    const discrepancyPerOrder = discrepancyAmount / codDeliveredOrders.length;
    const collectedAmounts: number[] = [];
    let distributedSum = 0;

    // Calculate all amounts first
    for (let i = 0; i < codDeliveredOrders.length; i++) {
      const codOrder = codDeliveredOrders[i];
      const collectedAmount = codOrder.expected + discrepancyPerOrder;
      const roundedAmount = Math.round(collectedAmount * 100) / 100;
      collectedAmounts.push(roundedAmount);
      distributedSum += roundedAmount;
    }

    // Validate: sum of distributed amounts must equal original discrepancy
    const roundedDiscrepancy = Math.round(discrepancyAmount * 100) / 100;
    const roundedSum = Math.round(distributedSum * 100) / 100;
    const difference = Math.abs(roundedSum - roundedDiscrepancy);

    // If there's a rounding error, adjust the last order
    if (difference > 0.01) {
      const adjustment = roundedDiscrepancy - roundedSum;
      collectedAmounts[collectedAmounts.length - 1] += adjustment;
      collectedAmounts[collectedAmounts.length - 1] = Math.round(collectedAmounts[collectedAmounts.length - 1] * 100) / 100;

      logger.warn('SETTLEMENTS', `[RECONCILIATION] Rounding adjustment applied: ${adjustment.toFixed(2)} to last order`, {
        original_discrepancy: roundedDiscrepancy,
        distributed_sum: roundedSum,
        adjustment
      });
    }

    // Now apply the amounts
    for (let i = 0; i < codDeliveredOrders.length; i++) {
      const codOrder = codDeliveredOrders[i];
      const collectedAmount = collectedAmounts[i];

      const { error } = await supabaseAdmin
        .from('orders')
        .update({
          amount_collected: collectedAmount,
          has_amount_discrepancy: true,
        })
        .eq('id', codOrder.id)
        .eq('store_id', storeId);

      if (error) {
        logger.error('SETTLEMENTS', `[RECONCILIATION] Error updating discrepancy for ${codOrder.id}`, error);
        errors.push(`Error marcando discrepancia en pedido ${codOrder.id}`);
      }
    }

    // Re-check errors after discrepancy distribution
    if (errors.length > 0) {
      throw new Error(`Errores al aplicar discrepancias: ${errors.join('; ')}`);
    }
  } else if (hasDiscrepancy && codDeliveredOrders.length === 0) {
    // BUG #3 FIX: Log discrepancy that cannot be distributed
    logger.error('SETTLEMENTS', `[RECONCILIATION] CRITICAL: Discrepancy of ${discrepancyAmount} exists but no COD orders to distribute to`, {
      discrepancy: discrepancyAmount,
      total_cod_orders: codDeliveredOrders.length,
      total_delivered: stats.total_delivered,
      total_prepaid_delivered: stats.total_prepaid_delivered
    });
    throw new Error(`Existe una discrepancia de ${discrepancyAmount.toLocaleString()} pero no hay pedidos COD entregados para distribuirla. Verifique los métodos de pago.`);
  }

  // ============================================================
  // SETTLEMENT CREATION PHASE
  // ============================================================

  // Generate settlement code atomically using RPC (prevents race conditions)
  const settlementCode = await generateSettlementCodeWithRetry(storeId);

  // Calculate net receivable
  // Formula: COD collected - carrier fees for delivered - failed attempt fees
  const netReceivable = stats.total_cod_collected - stats.total_carrier_fees - stats.failed_attempt_fee;

  // Build notes with discrepancy info if applicable
  let finalNotes = discrepancy_notes || '';
  if (hasDiscrepancy) {
    const discrepancyInfo = `Discrepancia: ${discrepancyAmount > 0 ? '+' : ''}${discrepancyAmount.toLocaleString()}`;
    finalNotes = finalNotes ? `${finalNotes} | ${discrepancyInfo}` : discrepancyInfo;
  }

  const { data: settlement, error: settlementError } = await supabaseAdmin
    .from('daily_settlements')
    .insert({
      store_id: storeId,
      carrier_id: carrier_id,
      settlement_code: settlementCode,
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
    logger.error('SETTLEMENTS', '[RECONCILIATION] Error creating settlement', settlementError);
    throw new Error(`Error al crear la liquidación: ${settlementError.message}`);
  }

  logger.info('SETTLEMENTS', `[RECONCILIATION] Settlement created: ${settlementCode}`, {
    delivered: stats.total_delivered,
    failed: stats.total_not_delivered,
    cod_collected: stats.total_cod_collected,
    net_receivable: netReceivable,
  });

  // CRITICAL: Link carrier movements to this settlement
  // For manual reconciliation, movements should already exist from QR/CSV import
  // But we link them to this settlement to mark as "settled"
  await supabaseAdmin
    .from('carrier_account_movements')
    .update({ settlement_id: settlement.id })
    .in('order_id', orderIds)
    .is('settlement_id', null);

  logger.info('SETTLEMENTS', `[RECONCILIATION] Linked carrier movements to settlement ${settlement.id}`);

  return {
    ...settlement,
    carrier_name: settlement.carriers?.name,
    carriers: undefined,
  };
}

// ============================================================
// CARRIER ACCOUNT SYSTEM
// ============================================================
// Unified system for tracking money flow between store and carriers
// Works with both dispatch/CSV flow AND direct QR marking flow

export interface CarrierAccountMovement {
  id: string;
  store_id: string;
  carrier_id: string;
  movement_type: 'cod_collected' | 'delivery_fee' | 'failed_attempt_fee' | 'payment_received' | 'payment_sent' | 'adjustment_credit' | 'adjustment_debit' | 'discount' | 'refund';
  amount: number;
  order_id: string | null;
  order_number: string | null;
  dispatch_session_id: string | null;
  settlement_id: string | null;
  payment_record_id: string | null;
  description: string | null;
  metadata: Record<string, any>;
  movement_date: string;
  created_at: string;
  created_by: string | null;
}

export interface CarrierPaymentRecord {
  id: string;
  store_id: string;
  carrier_id: string;
  payment_code: string;
  direction: 'from_carrier' | 'to_carrier';
  amount: number;
  period_start: string | null;
  period_end: string | null;
  settlement_ids: string[];
  movement_ids: string[];
  payment_method: 'cash' | 'bank_transfer' | 'mobile_payment' | 'check' | 'deduction' | 'other';
  payment_reference: string | null;
  status: 'pending' | 'completed' | 'cancelled' | 'disputed';
  notes: string | null;
  payment_date: string;
  created_at: string;
  created_by: string | null;
}

export interface CarrierBalance {
  carrier_id: string;
  carrier_name: string;
  settlement_type: 'net' | 'gross' | 'salary';
  charges_failed_attempts: boolean;
  payment_schedule: string;
  total_cod_collected: number;
  total_delivery_fees: number;
  total_failed_fees: number;
  total_payments_received: number;
  total_payments_sent: number;
  total_adjustments: number;
  net_balance: number;  // Positive = carrier owes store, Negative = store owes carrier
  unsettled_balance: number;
  unsettled_orders: number;
  last_movement_date: string | null;
  last_payment_date: string | null;
}

export interface CarrierBalanceSummary {
  carrier_id: string;
  carrier_name: string;
  settlement_type: string;
  period_start: string;
  period_end: string;
  cod_collected: number;
  delivery_fees: number;
  failed_fees: number;
  payments_received: number;
  payments_sent: number;
  adjustments: number;
  gross_balance: number;
  net_balance: number;
  orders_count: number;
  delivered_count: number;
  failed_count: number;
}

/**
 * Get all carrier balances for a store
 */
export async function getCarrierBalances(storeId: string): Promise<CarrierBalance[]> {
  const { data, error } = await supabaseAdmin
    .from('v_carrier_account_balance')
    .select('*')
    .eq('store_id', storeId)
    .order('net_balance', { ascending: false });

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error fetching balances', error);
    throw new Error('Error al obtener balances de transportadoras');
  }

  // BUG #2 FIX: Proper NaN/Infinity validation in parseFloat
  return (data || []).map(row => {
    const safeParseFloat = (value: any): number => {
      const parsed = parseFloat(value);
      if (isNaN(parsed) || !isFinite(parsed)) {
        logger.error('SETTLEMENTS', `[CARRIER BALANCES] Invalid numeric value: ${value}, using 0`);
        return 0;
      }
      return parsed;
    };

    const safeParseInt = (value: any): number => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || !isFinite(parsed)) {
        logger.error('SETTLEMENTS', `[CARRIER BALANCES] Invalid integer value: ${value}, using 0`);
        return 0;
      }
      return parsed;
    };

    return {
      carrier_id: row.carrier_id,
      carrier_name: row.carrier_name,
      settlement_type: row.settlement_type || 'gross',
      charges_failed_attempts: row.charges_failed_attempts || false,
      payment_schedule: row.payment_schedule || 'weekly',
      total_cod_collected: safeParseFloat(row.total_cod_collected),
      total_delivery_fees: safeParseFloat(row.total_delivery_fees),
      total_failed_fees: safeParseFloat(row.total_failed_fees),
      total_payments_received: safeParseFloat(row.total_payments_received),
      total_payments_sent: safeParseFloat(row.total_payments_sent),
      total_adjustments: safeParseFloat(row.total_adjustments),
      net_balance: safeParseFloat(row.net_balance),
      unsettled_balance: safeParseFloat(row.unsettled_balance),
      unsettled_orders: safeParseInt(row.unsettled_orders),
      last_movement_date: row.last_movement_date,
      last_payment_date: row.last_payment_date,
    };
  });
}

/**
 * Get detailed balance summary for a specific carrier
 */
export async function getCarrierBalanceSummary(
  carrierId: string,
  fromDate?: string,
  toDate?: string
): Promise<CarrierBalanceSummary | null> {
  const { data, error } = await supabaseAdmin.rpc('get_carrier_balance_summary', {
    p_carrier_id: carrierId,
    p_from_date: fromDate || null,
    p_to_date: toDate || null,
  });

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error fetching balance summary', error);
    throw new Error('Error al obtener resumen de balance de transportadora');
  }

  if (!data || data.length === 0) {
    return null;
  }

  const row = data[0];

  // BUG #2 FIX: Proper NaN/Infinity validation in parseFloat
  const safeParseFloat = (value: any): number => {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || !isFinite(parsed)) {
      logger.error('SETTLEMENTS', `[CARRIER BALANCE SUMMARY] Invalid numeric value: ${value}, using 0`);
      return 0;
    }
    return parsed;
  };

  const safeParseInt = (value: any): number => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || !isFinite(parsed)) {
      logger.error('SETTLEMENTS', `[CARRIER BALANCE SUMMARY] Invalid integer value: ${value}, using 0`);
      return 0;
    }
    return parsed;
  };

  return {
    carrier_id: row.carrier_id,
    carrier_name: row.carrier_name,
    settlement_type: row.settlement_type || 'gross',
    period_start: row.period_start,
    period_end: row.period_end,
    cod_collected: safeParseFloat(row.cod_collected),
    delivery_fees: safeParseFloat(row.delivery_fees),
    failed_fees: safeParseFloat(row.failed_fees),
    payments_received: safeParseFloat(row.payments_received),
    payments_sent: safeParseFloat(row.payments_sent),
    adjustments: safeParseFloat(row.adjustments),
    gross_balance: safeParseFloat(row.gross_balance),
    net_balance: safeParseFloat(row.net_balance),
    orders_count: safeParseInt(row.orders_count),
    delivered_count: safeParseInt(row.delivered_count),
    failed_count: safeParseInt(row.failed_count),
  };
}

/**
 * Get unsettled movements for a carrier
 */
export async function getUnsettledMovements(
  storeId: string,
  carrierId?: string
): Promise<CarrierAccountMovement[]> {
  let query = supabaseAdmin
    .from('v_unsettled_carrier_movements')
    .select('*')
    .eq('store_id', storeId)
    .order('movement_date', { ascending: false });

  if (carrierId) {
    query = query.eq('carrier_id', carrierId);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error fetching unsettled movements', error);
    throw new Error('Error al obtener movimientos pendientes');
  }

  return data || [];
}

/**
 * Get movement history for a carrier
 */
export async function getCarrierMovements(
  storeId: string,
  carrierId: string,
  options: {
    fromDate?: string;
    toDate?: string;
    movementType?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ data: CarrierAccountMovement[]; count: number }> {
  let query = supabaseAdmin
    .from('carrier_account_movements')
    .select('*', { count: 'exact' })
    .eq('store_id', storeId)
    .eq('carrier_id', carrierId)
    .order('movement_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (options.fromDate) {
    query = query.gte('movement_date', options.fromDate);
  }
  if (options.toDate) {
    query = query.lte('movement_date', options.toDate);
  }
  if (options.movementType) {
    query = query.eq('movement_type', options.movementType);
  }

  const limit = options.limit || 50;
  const offset = options.offset || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error fetching movements', error);
    throw new Error('Error al obtener movimientos de transportadora');
  }

  return { data: data || [], count: count || 0 };
}

/**
 * Create manual adjustment movement
 */
export async function createAdjustmentMovement(
  storeId: string,
  carrierId: string,
  amount: number,
  type: 'credit' | 'debit',
  description: string,
  createdBy?: string
): Promise<CarrierAccountMovement> {
  const movementType = type === 'credit' ? 'adjustment_credit' : 'adjustment_debit';
  // Credits reduce what carrier owes (negative), debits increase (positive)
  const adjustedAmount = type === 'credit' ? -Math.abs(amount) : Math.abs(amount);

  const { data, error } = await supabaseAdmin
    .from('carrier_account_movements')
    .insert({
      store_id: storeId,
      carrier_id: carrierId,
      movement_type: movementType,
      amount: adjustedAmount,
      description,
      movement_date: getTodayInTimezone(),
      created_by: createdBy,
      metadata: { manual_adjustment: true },
    })
    .select()
    .single();

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error creating adjustment', error);
    throw new Error('Error al crear ajuste');
  }

  return data;
}

/**
 * Register a payment to/from carrier
 */
export async function registerCarrierPayment(
  storeId: string,
  carrierId: string,
  amount: number,
  direction: 'from_carrier' | 'to_carrier',
  paymentMethod: string,
  options: {
    paymentReference?: string;
    notes?: string;
    settlementIds?: string[];
    movementIds?: string[];
    createdBy?: string;
  } = {}
): Promise<{ paymentId: string; paymentCode: string }> {
  const { data, error } = await supabaseAdmin.rpc('register_carrier_payment', {
    p_store_id: storeId,
    p_carrier_id: carrierId,
    p_amount: amount,
    p_direction: direction,
    p_payment_method: paymentMethod,
    p_payment_reference: options.paymentReference || null,
    p_notes: options.notes || null,
    p_settlement_ids: options.settlementIds || null,
    p_movement_ids: options.movementIds || null,
    p_created_by: options.createdBy || null,
  });

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error registering payment', error);
    throw new Error('Error al registrar pago');
  }

  // Get the payment code
  const { data: payment } = await supabaseAdmin
    .from('carrier_payment_records')
    .select('payment_code')
    .eq('id', data)
    .single();

  return {
    paymentId: data,
    paymentCode: payment?.payment_code || '',
  };
}

/**
 * Get payment history for a carrier
 */
export async function getCarrierPayments(
  storeId: string,
  carrierId?: string,
  options: {
    fromDate?: string;
    toDate?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ data: CarrierPaymentRecord[]; count: number }> {
  let query = supabaseAdmin
    .from('carrier_payment_records')
    .select(`
      *,
      carriers!inner(name)
    `, { count: 'exact' })
    .eq('store_id', storeId)
    .order('payment_date', { ascending: false });

  if (carrierId) {
    query = query.eq('carrier_id', carrierId);
  }
  if (options.fromDate) {
    query = query.gte('payment_date', options.fromDate);
  }
  if (options.toDate) {
    query = query.lte('payment_date', options.toDate);
  }
  if (options.status) {
    query = query.eq('status', options.status);
  }

  const limit = options.limit || 50;
  const offset = options.offset || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error fetching payments', error);
    throw new Error('Error al obtener pagos de transportadora');
  }

  return {
    data: (data || []).map((p: any) => ({
      ...p,
      carrier_name: p.carriers?.name,
    })),
    count: count || 0,
  };
}

/**
 * Update carrier configuration
 */
export async function updateCarrierConfig(
  carrierId: string,
  storeId: string,
  config: {
    settlement_type?: 'net' | 'gross' | 'salary';
    charges_failed_attempts?: boolean;
    payment_schedule?: string;
    failed_attempt_fee_percent?: number;
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('carriers')
    .update({
      ...config,
      updated_at: new Date().toISOString(),
    })
    .eq('id', carrierId)
    .eq('store_id', storeId);

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error updating carrier config', error);
    throw new Error('Error al actualizar configuración de transportadora');
  }
}

/**
 * Get carrier configuration
 */
export async function getCarrierConfig(
  carrierId: string,
  storeId: string
): Promise<{
  settlement_type: string;
  charges_failed_attempts: boolean;
  payment_schedule: string;
  failed_attempt_fee_percent: number;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('carriers')
    .select('settlement_type, charges_failed_attempts, payment_schedule, failed_attempt_fee_percent')
    .eq('id', carrierId)
    .eq('store_id', storeId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    settlement_type: data.settlement_type || 'gross',
    charges_failed_attempts: data.charges_failed_attempts || false,
    payment_schedule: data.payment_schedule || 'weekly',
    failed_attempt_fee_percent: data.failed_attempt_fee_percent ?? 50,
  };
}

/**
 * Backfill movements for existing delivered orders (run once after migration)
 */
export async function backfillCarrierMovements(storeId?: string): Promise<{
  ordersProcessed: number;
  movementsCreated: number;
}> {
  const { data, error } = await supabaseAdmin.rpc('backfill_carrier_movements', {
    p_store_id: storeId || null,
  });

  if (error) {
    logger.error('SETTLEMENTS', '[CARRIER ACCOUNTS] Error backfilling movements', error);
    throw new Error('Error al rellenar movimientos de transportadora');
  }

  const result = data?.[0] || { orders_processed: 0, movements_created: 0 };
  return {
    ordersProcessed: result.orders_processed,
    movementsCreated: result.movements_created,
  };
}

/**
 * Get carrier account summary for dashboard cards
 */
export async function getCarrierAccountSummary(storeId: string): Promise<{
  totalCarriersWithBalance: number;
  totalOwedByCarriers: number;  // Positive balances (they owe us)
  totalOwedToCarriers: number;  // Negative balances (we owe them)
  netPosition: number;
  pendingSettlements: number;
}> {
  const balances = await getCarrierBalances(storeId);

  let totalOwedByCarriers = 0;
  let totalOwedToCarriers = 0;
  let carriersWithBalance = 0;

  for (const balance of balances) {
    if (Math.abs(balance.net_balance) > 0.01) {
      carriersWithBalance++;
      if (balance.net_balance > 0) {
        totalOwedByCarriers += balance.net_balance;
      } else {
        totalOwedToCarriers += Math.abs(balance.net_balance);
      }
    }
  }

  // Count pending settlements
  const { count: pendingSettlements } = await supabaseAdmin
    .from('daily_settlements')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .in('status', ['pending', 'partial']);

  return {
    totalCarriersWithBalance: carriersWithBalance,
    totalOwedByCarriers,
    totalOwedToCarriers,
    netPosition: totalOwedByCarriers - totalOwedToCarriers,
    pendingSettlements: pendingSettlements || 0,
  };
}

// ============================================================
// DELIVERY-BASED RECONCILIATION (NEW SYSTEM)
// Groups by delivery date instead of dispatch date for simpler UX
// ============================================================

export interface DeliveryDateGroup {
  delivery_date: string;
  carrier_id: string;
  carrier_name: string;
  failed_attempt_fee_percent: number;
  total_orders: number;
  total_cod: number;
  total_prepaid: number;
}

export interface PendingReconciliationOrder {
  id: string;
  display_order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_city: string;
  total_price: number;
  cod_amount: number;
  payment_method: string;
  prepaid_method: string | null;
  is_cod: boolean;
  delivered_at: string;
  carrier_fee: number;
  // Debug fields for fee troubleshooting
  fee_source: 'coverage' | 'zone' | 'default';
  normalized_city: string;
}

/**
 * Get pending reconciliation groups - delivered orders grouped by date and carrier
 * This is the main entry point for the new delivery-based reconciliation flow
 */
export async function getPendingReconciliation(storeId: string): Promise<DeliveryDateGroup[]> {
  logger.info('SETTLEMENTS', 'getPendingReconciliation called', { storeId });

  try {
    const { data, error } = await supabaseAdmin
      .from('v_pending_reconciliation')
      .select('*')
      .eq('store_id', storeId)
      .order('delivery_date', { ascending: false });

    if (error) {
      logger.error('SETTLEMENTS', 'Error fetching pending reconciliation', error);
      // Fallback to direct query if view doesn't exist yet
      return await getPendingReconciliationFallback(storeId);
    }

    logger.info('SETTLEMENTS', `Found ${data?.length || 0} pending reconciliation groups`);
    return data || [];
  } catch (err: any) {
    logger.error('SETTLEMENTS', 'Unexpected error in getPendingReconciliation', err);
    return [];
  }
}

/**
 * Fallback query if view doesn't exist (for pre-migration compatibility)
 */
async function getPendingReconciliationFallback(storeId: string): Promise<DeliveryDateGroup[]> {
  logger.info('SETTLEMENTS', 'Using fallback query for pending reconciliation');

  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select(`
      id,
      delivered_at,
      courier_id,
      total_price,
      payment_method,
      prepaid_method
    `)
    .eq('store_id', storeId)
    .eq('sleeves_status', 'delivered')
    .is('reconciled_at', null)
    .not('delivered_at', 'is', null)
    .not('courier_id', 'is', null);

  if (error || !orders || orders.length === 0) {
    return [];
  }

  // Get carrier info
  const carrierIds = [...new Set(orders.map(o => o.courier_id))];
  const { data: carriers } = await supabaseAdmin
    .from('carriers')
    .select('id, name, failed_attempt_fee_percent')
    .in('id', carrierIds);

  const carrierMap = new Map(carriers?.map(c => [c.id, c]) || []);

  // Group by date and carrier
  const groupMap = new Map<string, DeliveryDateGroup>();

  orders.forEach((order: any) => {
    const deliveryDate = new Date(order.delivered_at).toISOString().split('T')[0];
    const groupKey = `${order.courier_id}_${deliveryDate}`;
    const carrier = carrierMap.get(order.courier_id);
    // IMPORTANT: If prepaid_method is set, it's NOT COD (even if payment_method was 'efectivo')
    // This handles the case where customer paid via transfer/QR before delivery
    const isCod = !order.prepaid_method && isCodPayment(order.payment_method);

    if (groupMap.has(groupKey)) {
      const group = groupMap.get(groupKey)!;
      group.total_orders++;
      if (isCod) {
        group.total_cod += order.total_price || 0;
      } else {
        group.total_prepaid++;
      }
    } else {
      groupMap.set(groupKey, {
        delivery_date: deliveryDate,
        carrier_id: order.courier_id,
        carrier_name: carrier?.name || 'Sin courier',
        failed_attempt_fee_percent: carrier?.failed_attempt_fee_percent ?? 50,
        total_orders: 1,
        total_cod: isCod ? (order.total_price || 0) : 0,
        total_prepaid: isCod ? 0 : 1,
      });
    }
  });

  return Array.from(groupMap.values()).sort((a, b) =>
    new Date(b.delivery_date).getTime() - new Date(a.delivery_date).getTime()
  );
}

/**
 * Get orders for a specific delivery date and carrier
 *
 * NOTE: We always use direct query instead of RPC because:
 * 1. The RPC (get_pending_reconciliation_orders) does NOT return carrier_fee
 * 2. carrier_fee requires city-based coverage lookup with accent normalization
 * 3. Direct query also returns prepaid_method and debug fields (fee_source, normalized_city)
 */
export async function getPendingReconciliationOrders(
  storeId: string,
  carrierId: string,
  deliveryDate: string
): Promise<PendingReconciliationOrder[]> {
  logger.info('SETTLEMENTS', 'getPendingReconciliationOrders called', {
    storeId,
    carrierId,
    deliveryDate
  });

  return await getPendingReconciliationOrdersFallback(storeId, carrierId, deliveryDate);
}

/**
 * Fallback query for orders if RPC doesn't exist
 */
async function getPendingReconciliationOrdersFallback(
  storeId: string,
  carrierId: string,
  deliveryDate: string
): Promise<PendingReconciliationOrder[]> {
  const startOfDay = `${deliveryDate}T00:00:00.000Z`;
  const endOfDay = `${deliveryDate}T23:59:59.999Z`;

  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select(`
      id,
      shopify_order_name,
      shopify_order_number,
      customer_first_name,
      customer_last_name,
      customer_phone,
      shipping_address,
      delivery_zone,
      shipping_city,
      shipping_city_normalized,
      total_price,
      payment_method,
      prepaid_method,
      delivered_at
    `)
    .eq('store_id', storeId)
    .eq('courier_id', carrierId)
    .eq('sleeves_status', 'delivered')
    .is('reconciled_at', null)
    .gte('delivered_at', startOfDay)
    .lte('delivered_at', endOfDay)
    .order('delivered_at', { ascending: true });

  if (error || !orders) {
    logger.error('SETTLEMENTS', 'Error in fallback orders query', error);
    return [];
  }

  // Fetch carrier zone rates (legacy system)
  const { data: zones } = await supabaseAdmin
    .from('carrier_zones')
    .select('zone_name, rate')
    .eq('carrier_id', carrierId)
    .eq('store_id', storeId);

  // Fetch city-based coverage rates (new system - migration 090)
  // IMPORTANT: Normalize city names to remove accents for consistent matching
  const { data: coverage } = await supabaseAdmin
    .from('carrier_coverage')
    .select('city, rate')
    .eq('carrier_id', carrierId)
    .eq('is_active', true);

  const coverageRates = new Map<string, number>();
  (coverage || []).forEach(c => {
    if (c.city && c.rate != null) {
      coverageRates.set(normalizeCityText(c.city), c.rate);
    }
  });

  // IMPORTANT: Normalize zone names to strip accents (e.g., "Asunción" → "asuncion")
  const zoneRates = new Map(zones?.map(z => [normalizeCityText(z.zone_name), z.rate || 0]) || []);
  const defaultRate = zones?.[0]?.rate || 0;

  return orders.map((order: any) => {
    // IMPORTANT: If prepaid_method is set, it's NOT COD (even if payment_method was 'efectivo')
    // This handles the case where customer paid via transfer/QR before delivery
    const isCod = !order.prepaid_method && isCodPayment(order.payment_method);

    // Unified display order number - always #XXXX format
    let displayOrderNumber: string;
    if (order.shopify_order_name) {
      displayOrderNumber = order.shopify_order_name;
    } else if (order.shopify_order_number) {
      displayOrderNumber = `#${order.shopify_order_number}`;
    } else {
      displayOrderNumber = `#${order.id.slice(-4).toUpperCase()}`;
    }

    // Calculate carrier fee: coverage (city) → zone (delivery_zone) → zone (shipping_city) → default
    const normalizedCity = order.shipping_city_normalized || normalizeCityText(order.shipping_city);
    const normalizedZone = normalizeCityText(order.delivery_zone);

    let carrierFee = defaultRate;
    let feeSource: 'coverage' | 'zone' | 'default' = 'default';
    if (normalizedCity && coverageRates.has(normalizedCity)) {
      carrierFee = coverageRates.get(normalizedCity)!;
      feeSource = 'coverage';
    } else if (normalizedZone && zoneRates.has(normalizedZone)) {
      carrierFee = zoneRates.get(normalizedZone)!;
      feeSource = 'zone';
    } else if (normalizedCity && zoneRates.has(normalizedCity)) {
      // Fallback: check shipping_city against zone names (for carriers that use city names as zone_names)
      carrierFee = zoneRates.get(normalizedCity)!;
      feeSource = 'zone';
    }

    logger.debug('SETTLEMENTS', `Fee calc for order ${order.id}`, {
      shipping_city: order.shipping_city,
      shipping_city_normalized: order.shipping_city_normalized,
      normalizedCity,
      normalizedZone,
      feeSource,
      carrierFee,
      coverageKeys: Array.from(coverageRates.keys()).join(', ')
    });

    return {
      id: order.id,
      display_order_number: displayOrderNumber,
      customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
      customer_phone: order.customer_phone || '',
      customer_address: typeof order.shipping_address === 'string'
        ? order.shipping_address
        : (order.shipping_address?.address1 || ''),
      customer_city: order.shipping_city || order.delivery_zone || '',
      total_price: order.total_price || 0,
      cod_amount: isCod ? (order.total_price || 0) : 0,
      payment_method: order.payment_method || '',
      prepaid_method: order.prepaid_method || null,
      is_cod: isCod,
      delivered_at: order.delivered_at,
      carrier_fee: carrierFee,
      fee_source: feeSource,
      normalized_city: normalizedCity
    };
  });
}

export interface ProcessDeliveryReconciliationParams {
  carrier_id: string;
  delivery_date: string;
  total_amount_collected: number;
  discrepancy_notes?: string;
  orders: Array<{
    order_id: string;
    delivered: boolean;
    failure_reason?: string;
    override_prepaid?: boolean; // User override: treat COD as prepaid for this reconciliation
  }>;
}

/**
 * Process delivery-based reconciliation
 */
export async function processDeliveryReconciliation(
  storeId: string,
  userId: string,
  params: ProcessDeliveryReconciliationParams
): Promise<{
  settlement_id: string;
  settlement_code: string;
  total_orders: number;
  total_delivered: number;
  total_not_delivered: number;
  total_cod_expected: number;
  total_cod_collected: number;
  total_carrier_fees: number;
  failed_attempt_fee: number;
  net_receivable: number;
}> {
  logger.info('SETTLEMENTS', 'processDeliveryReconciliation called', {
    storeId,
    carrierId: params.carrier_id,
    deliveryDate: params.delivery_date,
    orderCount: params.orders.length
  });

  try {
    // NOTE: We always use the Node.js fallback instead of the DB RPC because:
    // 1. The RPC (process_delivery_reconciliation) only uses legacy carrier_zones
    // 2. It does NOT use carrier_coverage (city-based rates with accent normalization)
    // 3. This causes incorrect carrier fee calculations for city-based coverage
    // TODO: Update the RPC to use carrier_coverage (migration needed)
    return await processDeliveryReconciliationFallback(storeId, userId, params);
  } catch (err: any) {
    logger.error('SETTLEMENTS', 'Error in processDeliveryReconciliation', {
      message: err.message,
      stack: err.stack
    });
    throw err;
  }
}

/**
 * Fallback processing if RPC doesn't exist
 * CRITICAL: This fallback must maintain consistent behavior with the RPC
 * - Non-delivered orders keep their status (delivered), only reconciled_at is set
 * - Uses atomic settlement code generation to prevent duplicates
 * - Validates all orders before processing
 */
async function processDeliveryReconciliationFallback(
  storeId: string,
  userId: string,
  params: ProcessDeliveryReconciliationParams
): Promise<any> {
  logger.info('SETTLEMENTS', 'Starting fallback reconciliation processing', {
    storeId,
    carrierId: params.carrier_id,
    orderCount: params.orders.length
  });

  // STEP 1: Validate all orders exist and belong to this store BEFORE processing
  const orderIds = params.orders.map(o => o.order_id);
  const { data: existingOrders, error: fetchError } = await supabaseAdmin
    .from('orders')
    .select('id, total_price, payment_method, prepaid_method, delivery_zone, shipping_city, shipping_city_normalized, reconciled_at, store_id')
    .in('id', orderIds)
    .eq('store_id', storeId);

  if (fetchError) {
    logger.error('SETTLEMENTS', 'Error fetching orders for validation', fetchError);
    throw new Error('Error al validar los pedidos');
  }

  // Validate all orders exist
  const foundOrderIds = new Set(existingOrders?.map(o => o.id) || []);
  const missingOrders = orderIds.filter(id => !foundOrderIds.has(id));
  if (missingOrders.length > 0) {
    throw new Error(`Pedidos no encontrados o no pertenecen a esta tienda: ${missingOrders.length}`);
  }

  // Check if any orders are already reconciled
  const alreadyReconciled = existingOrders?.filter(o => o.reconciled_at !== null) || [];
  if (alreadyReconciled.length > 0) {
    throw new Error(`Algunos pedidos ya fueron conciliados: ${alreadyReconciled.length}`);
  }

  // Create a map for quick lookup
  const orderMap = new Map(existingOrders?.map(o => [o.id, o]) || []);

  // STEP 2: Get carrier info
  const { data: carrier } = await supabaseAdmin
    .from('carriers')
    .select('name, failed_attempt_fee_percent')
    .eq('id', params.carrier_id)
    .single();

  if (!carrier) {
    throw new Error('Transportadora no encontrada');
  }

  const failedFeePercent = carrier?.failed_attempt_fee_percent ?? 50;

  // STEP 3: Get zone rates for this carrier (legacy system)
  const { data: zones } = await supabaseAdmin
    .from('carrier_zones')
    .select('zone_name, rate')
    .eq('carrier_id', params.carrier_id)
    .eq('store_id', storeId);

  // Also get city-based coverage (new system - migration 090)
  const { data: coverage } = await supabaseAdmin
    .from('carrier_coverage')
    .select('city, rate')
    .eq('carrier_id', params.carrier_id)
    .eq('is_active', true);

  // Build coverage map from new system (city -> rate)
  // IMPORTANT: Normalize city names to remove accents for consistent matching
  const coverageRates = new Map<string, number>();
  (coverage || []).forEach(c => {
    if (c.city && c.rate != null) {
      coverageRates.set(normalizeCityText(c.city), c.rate);
    }
  });

  // IMPORTANT: Normalize zone names to strip accents (e.g., "Asunción" → "asuncion")
  const zoneRates = new Map(zones?.map(z => [normalizeCityText(z.zone_name), z.rate || 0]) || []);
  const defaultRate = zones?.[0]?.rate || 0;

  // STEP 4: Calculate totals (all in memory first, before any updates)
  let totalOrders = 0;
  let totalDelivered = 0;
  let totalNotDelivered = 0;
  let totalCodExpected = 0;
  let totalCodDelivered = 0;
  let totalPrepaidDelivered = 0;
  let totalCarrierFees = 0;
  let failedAttemptFee = 0;

  const orderUpdates: Array<{ id: string; reconciled_at: string }> = [];

  for (const orderData of params.orders) {
    const order = orderMap.get(orderData.order_id);
    if (!order) continue; // Already validated, but safety check

    totalOrders++;

    // Calculate fee: coverage (city) → zone (delivery_zone) → zone (shipping_city) → default
    const normalizedCity = order.shipping_city_normalized || normalizeCityText(order.shipping_city);
    const normalizedZone = normalizeCityText(order.delivery_zone);

    let zoneRate = defaultRate;
    let feeSource = 'default';
    if (normalizedCity && coverageRates.has(normalizedCity)) {
      zoneRate = coverageRates.get(normalizedCity)!;
      feeSource = 'coverage';
    } else if (normalizedZone && zoneRates.has(normalizedZone)) {
      zoneRate = zoneRates.get(normalizedZone)!;
      feeSource = 'zone';
    } else if (normalizedCity && zoneRates.has(normalizedCity)) {
      // Fallback: check shipping_city against zone names (for carriers that use city names as zone_names)
      zoneRate = zoneRates.get(normalizedCity)!;
      feeSource = 'zone';
    }

    logger.debug('SETTLEMENTS', `Process fee for order ${order.id}`, {
      shipping_city: order.shipping_city,
      normalizedCity,
      normalizedZone,
      feeSource,
      zoneRate,
      delivered: orderData.delivered
    });

    // IMPORTANT: Determine if this is COD for reconciliation calculation
    // Order is COD only if:
    // 1. prepaid_method is NOT set (customer didn't pay before delivery)
    // 2. payment_method is a COD type (efectivo, cash, etc.)
    // 3. User did NOT override to mark as prepaid during reconciliation
    const baseCod = !order.prepaid_method && isCodPayment(order.payment_method);
    const isCod = baseCod && !orderData.override_prepaid;

    if (orderData.delivered) {
      totalDelivered++;
      totalCarrierFees += zoneRate;
      if (isCod) {
        totalCodExpected += order.total_price || 0;
        totalCodDelivered++;
      } else {
        totalPrepaidDelivered++;
      }
    } else {
      totalNotDelivered++;
      failedAttemptFee += zoneRate * failedFeePercent / 100;
    }

    // Queue the update (don't execute yet)
    orderUpdates.push({
      id: order.id,
      reconciled_at: new Date().toISOString()
    });
  }

  if (totalOrders === 0) {
    throw new Error('No hay pedidos válidos para procesar');
  }

  const netReceivable = params.total_amount_collected - totalCarrierFees - failedAttemptFee;

  // STEP 5: Generate settlement code atomically
  // Format: LIQ-DDMMYYYY-XXX (e.g., LIQ-23012026-001)
  const [year, month, day] = params.delivery_date.split('-');
  const dateFormatted = `${day}${month}${year}`;
  const codePrefix = `LIQ-${dateFormatted}`;

  // Find existing settlements with this prefix to determine next number
  const { data: existingSettlements } = await supabaseAdmin
    .from('daily_settlements')
    .select('settlement_code')
    .eq('store_id', storeId)
    .like('settlement_code', `${codePrefix}-%`)
    .order('settlement_code', { ascending: false })
    .limit(1);

  let nextNumber = 1;
  if (existingSettlements && existingSettlements.length > 0) {
    const lastCode = existingSettlements[0].settlement_code;
    const lastNumberStr = lastCode.split('-').pop();
    const lastNumber = parseInt(lastNumberStr || '0', 10);
    nextNumber = lastNumber + 1;
  }

  const settlementCode = `${codePrefix}-${String(nextNumber).padStart(3, '0')}`;

  // STEP 6: Create settlement record FIRST (to catch unique constraint violation)
  const { data: settlement, error: settlementError } = await supabaseAdmin
    .from('daily_settlements')
    .insert({
      store_id: storeId,
      carrier_id: params.carrier_id,
      settlement_code: settlementCode,
      settlement_date: params.delivery_date,
      total_dispatched: totalOrders,
      total_delivered: totalDelivered,
      total_not_delivered: totalNotDelivered,
      total_cod_delivered: totalCodDelivered,
      total_prepaid_delivered: totalPrepaidDelivered,
      total_cod_collected: params.total_amount_collected,
      total_carrier_fees: totalCarrierFees,
      failed_attempt_fee: failedAttemptFee,
      net_receivable: netReceivable,
      balance_due: netReceivable,
      status: 'pending',
      notes: params.discrepancy_notes,
      created_by: userId
    })
    .select()
    .single();

  if (settlementError) {
    // Check if it's a duplicate code error (race condition)
    if (settlementError.code === '23505') {
      logger.warn('SETTLEMENTS', 'Settlement code collision, retrying with incremented number');
      // Retry with incremented number
      const retryCode = `${codePrefix}-${String(nextNumber + 1).padStart(3, '0')}`;
      const { data: retrySettlement, error: retryError } = await supabaseAdmin
        .from('daily_settlements')
        .insert({
          store_id: storeId,
          carrier_id: params.carrier_id,
          settlement_code: retryCode,
          settlement_date: params.delivery_date,
          total_dispatched: totalOrders,
          total_delivered: totalDelivered,
          total_not_delivered: totalNotDelivered,
          total_cod_delivered: totalCodDelivered,
          total_prepaid_delivered: totalPrepaidDelivered,
          total_cod_collected: params.total_amount_collected,
          total_carrier_fees: totalCarrierFees,
          failed_attempt_fee: failedAttemptFee,
          net_receivable: netReceivable,
          balance_due: netReceivable,
          status: 'pending',
          notes: params.discrepancy_notes,
          created_by: userId
        })
        .select()
        .single();

      if (retryError) {
        logger.error('SETTLEMENTS', 'Retry also failed', retryError);
        throw new Error('Error al crear la liquidación (código duplicado)');
      }

      // Continue with retry settlement
      return processOrderUpdatesAndReturn(
        retrySettlement!,
        retryCode,
        totalOrders,
        totalDelivered,
        totalNotDelivered,
        totalCodExpected,
        params.total_amount_collected,
        totalCarrierFees,
        failedAttemptFee,
        netReceivable,
        orderUpdates
      );
    }

    logger.error('SETTLEMENTS', 'Error creating settlement', settlementError);
    throw new Error('Error al crear la liquidación');
  }

  // STEP 7: Update all orders as reconciled
  return processOrderUpdatesAndReturn(
    settlement,
    settlementCode,
    totalOrders,
    totalDelivered,
    totalNotDelivered,
    totalCodExpected,
    params.total_amount_collected,
    totalCarrierFees,
    failedAttemptFee,
    netReceivable,
    orderUpdates
  );
}

/**
 * Helper to update orders and return result
 * CRITICAL: Only sets reconciled_at, does NOT change sleeves_status
 * This matches the RPC behavior for consistency
 */
async function processOrderUpdatesAndReturn(
  settlement: any,
  settlementCode: string,
  totalOrders: number,
  totalDelivered: number,
  totalNotDelivered: number,
  totalCodExpected: number,
  totalCodCollected: number,
  totalCarrierFees: number,
  failedAttemptFee: number,
  netReceivable: number,
  orderUpdates: Array<{ id: string; reconciled_at: string }>
): Promise<any> {
  // Update orders in batches of 50 for performance
  const batchSize = 50;
  for (let i = 0; i < orderUpdates.length; i += batchSize) {
    const batch = orderUpdates.slice(i, i + batchSize);
    const ids = batch.map(o => o.id);
    const reconciled_at = batch[0].reconciled_at;

    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ reconciled_at })
      .in('id', ids);

    if (updateError) {
      logger.error('SETTLEMENTS', 'Error updating orders batch', {
        batch: i / batchSize,
        error: updateError
      });
      // Don't throw - settlement already created, orders will be updated on next reconciliation attempt
      // This is a tradeoff: we prefer not to orphan the settlement record
    }
  }

  logger.info('SETTLEMENTS', 'Fallback reconciliation completed', {
    settlement_id: settlement.id,
    settlement_code: settlementCode,
    orders_updated: orderUpdates.length
  });

  return {
    settlement_id: settlement.id,
    settlement_code: settlementCode,
    total_orders: totalOrders,
    total_delivered: totalDelivered,
    total_not_delivered: totalNotDelivered,
    total_cod_expected: totalCodExpected,
    total_cod_collected: totalCodCollected,
    total_carrier_fees: totalCarrierFees,
    failed_attempt_fee: failedAttemptFee,
    net_receivable: netReceivable
  };
}

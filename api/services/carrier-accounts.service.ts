/**
 * Carrier Accounts Service
 *
 * TypeScript wrapper for carrier account movement functions.
 * These functions interact with the unified carrier account system (migration 065).
 *
 * Business Logic:
 * - When courier delivers COD order → They OWE us the COD amount (positive)
 * - When courier delivers ANY order → We OWE them the carrier fee (negative)
 * - When courier fails delivery → We may OWE them partial fee (negative, configurable)
 * - Net balance = What they owe us - What we owe them
 * - Positive balance = Courier owes store
 * - Negative balance = Store owes courier
 *
 * Author: Claude Code
 * Date: 2026-01-14
 */

import { supabaseAdmin } from '../db/connection';

// ============================================================
// TYPES
// ============================================================

export interface CarrierMovement {
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

export interface CarrierBalance {
  carrier_id: string;
  carrier_name: string;
  settlement_type: string;
  charges_failed_attempts: boolean;
  payment_schedule: string;
  total_cod_collected: number;
  total_delivery_fees: number;
  total_failed_fees: number;
  total_payments_received: number;
  total_payments_sent: number;
  total_adjustments: number;
  net_balance: number; // Positive = carrier owes store, Negative = store owes carrier
  unsettled_balance: number;
  unsettled_orders: number;
  last_movement_date: string | null;
  last_payment_date: string | null;
}

export interface DeliveryMovementsResult {
  cod_movement_id: string | null;
  fee_movement_id: string | null;
  total_cod: number;
  total_fee: number;
}

export interface PaymentRecord {
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
  payment_method: string;
  payment_reference: string | null;
  status: 'pending' | 'completed' | 'cancelled' | 'disputed';
  notes: string | null;
  payment_date: string;
  created_at: string;
  created_by: string | null;
}

// ============================================================
// CARRIER MOVEMENTS
// ============================================================

/**
 * Create account movements for a delivered order
 *
 * This function calls the SQL function `create_delivery_movements` which:
 * 1. Determines if order is COD or prepaid
 * 2. Creates COD collection movement (if COD)
 * 3. Creates delivery fee movement (always for delivered orders)
 * 4. Uses ON CONFLICT to prevent duplicates
 *
 * @param orderId - Order UUID
 * @param amountCollected - Amount collected from customer (for COD orders)
 * @param dispatchSessionId - Optional dispatch session reference
 * @param createdBy - Optional user ID who created this
 * @returns Movement IDs and amounts created
 */
export async function createDeliveryMovements(
  orderId: string,
  amountCollected?: number,
  dispatchSessionId?: string,
  createdBy?: string
): Promise<DeliveryMovementsResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc('create_delivery_movements', {
      p_order_id: orderId,
      p_amount_collected: amountCollected || null,
      p_dispatch_session_id: dispatchSessionId || null,
      p_created_by: createdBy || null
    });

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error creating delivery movements:', error);
      throw new Error(`Error al crear movimientos de entrega: ${error.message}`);
    }

    // SQL function returns array with single row
    const result = Array.isArray(data) ? data[0] : data;

    logger.info('BACKEND', `✅ [CARRIER ACCOUNTS] Created movements for order ${orderId}:`, {
      cod_movement: result?.cod_movement_id || 'none',
      fee_movement: result?.fee_movement_id || 'none',
      cod_amount: result?.total_cod || 0,
      fee_amount: result?.total_fee || 0
    });

    return result || {
      cod_movement_id: null,
      fee_movement_id: null,
      total_cod: 0,
      total_fee: 0
    };
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in createDeliveryMovements:', error);
    throw error;
  }
}

/**
 * Create failed attempt fee movement
 *
 * Only creates movement if:
 * 1. Carrier has charges_failed_attempts = true
 * 2. Order has a carrier assigned
 *
 * Fee is typically 50% of the normal delivery fee.
 *
 * @param orderId - Order UUID
 * @param dispatchSessionId - Optional dispatch session reference
 * @param createdBy - Optional user ID
 * @returns Movement ID or null if not applicable
 */
export async function createFailedDeliveryMovement(
  orderId: string,
  dispatchSessionId?: string,
  createdBy?: string
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('create_failed_delivery_movement', {
      p_order_id: orderId,
      p_dispatch_session_id: dispatchSessionId || null,
      p_created_by: createdBy || null
    });

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error creating failed delivery movement:', error);
      throw new Error(`Error al crear movimiento de entrega fallida: ${error.message}`);
    }

    if (data) {
      logger.info('BACKEND', `✅ [CARRIER ACCOUNTS] Created failed attempt fee for order ${orderId}`);
    } else {
      logger.info('BACKEND', `ℹ️ [CARRIER ACCOUNTS] No failed attempt fee for order ${orderId} (carrier doesn't charge)`);
    }

    return data;
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in createFailedDeliveryMovement:', error);
    throw error;
  }
}

/**
 * Get carrier fee for a specific zone
 *
 * Uses intelligent fallback logic:
 * 1. Try exact zone match
 * 2. Try fallback zones (default, otros, interior, general)
 * 3. Use first active zone
 * 4. Return 0 if no zones configured
 *
 * @param carrierId - Carrier UUID
 * @param zoneName - Primary zone name (e.g., "Asunción")
 * @param city - Optional city name for fallback
 * @returns Fee amount in currency
 */
export async function getCarrierFeeForZone(
  carrierId: string,
  zoneName: string,
  city?: string
): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_carrier_fee_for_order', {
      p_carrier_id: carrierId,
      p_zone_name: zoneName,
      p_city: city || null
    });

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error getting carrier fee:', error);
      return 0; // Return 0 on error to prevent breaking flow
    }

    return data || 0;
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in getCarrierFeeForZone:', error);
    return 0;
  }
}

// ============================================================
// CARRIER BALANCES
// ============================================================

/**
 * Get balance for all carriers in a store
 *
 * Returns aggregated view of:
 * - Total COD collected (what they owe us)
 * - Total fees owed (what we owe them)
 * - Net balance (positive = they owe us, negative = we owe them)
 * - Unsettled amounts (not yet in formal settlement/payment)
 *
 * @param storeId - Store UUID
 * @returns Array of carrier balances
 */
export async function getCarrierBalances(storeId: string): Promise<CarrierBalance[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('v_carrier_account_balance')
      .select('*')
      .eq('store_id', storeId)
      .order('net_balance', { ascending: false });

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error fetching balances:', error);
      throw new Error(`Error al obtener saldos de transportadoras: ${error.message}`);
    }

    return data || [];
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in getCarrierBalances:', error);
    throw error;
  }
}

/**
 * Get detailed balance summary for a single carrier
 *
 * Optionally filtered by date range.
 *
 * @param carrierId - Carrier UUID
 * @param fromDate - Optional start date (YYYY-MM-DD)
 * @param toDate - Optional end date (YYYY-MM-DD)
 * @returns Detailed balance breakdown
 */
export async function getCarrierBalanceSummary(
  carrierId: string,
  fromDate?: string,
  toDate?: string
): Promise<any> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_carrier_balance_summary', {
      p_carrier_id: carrierId,
      p_from_date: fromDate || null,
      p_to_date: toDate || null
    });

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error fetching balance summary:', error);
      throw new Error(`Error al obtener resumen de saldo: ${error.message}`);
    }

    // RPC returns array with single row
    const result = Array.isArray(data) ? data[0] : data;
    return result || null;
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in getCarrierBalanceSummary:', error);
    throw error;
  }
}

/**
 * Get unsettled movements for a carrier
 *
 * Returns movements not yet included in a settlement or payment.
 * Useful for creating new settlements.
 *
 * @param storeId - Store UUID
 * @param carrierId - Optional carrier filter
 * @returns Array of unsettled movements
 */
export async function getUnsettledMovements(
  storeId: string,
  carrierId?: string
): Promise<CarrierMovement[]> {
  try {
    let query = supabaseAdmin
      .from('v_unsettled_carrier_movements')
      .select('*')
      .eq('store_id', storeId)
      .order('movement_date', { ascending: true });

    if (carrierId) {
      query = query.eq('carrier_id', carrierId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error fetching unsettled movements:', error);
      throw new Error(`Error al obtener movimientos sin liquidar: ${error.message}`);
    }

    return data || [];
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in getUnsettledMovements:', error);
    throw error;
  }
}

// ============================================================
// PAYMENTS
// ============================================================

/**
 * Register a payment to/from a carrier
 *
 * This function:
 * 1. Creates a payment record
 * 2. Creates offsetting movement (reduces balance)
 * 3. Links movements/settlements covered by payment
 * 4. Updates settlement status if applicable
 *
 * @param payment - Payment details
 * @returns Payment record ID
 */
export async function registerCarrierPayment(payment: {
  storeId: string;
  carrierId: string;
  amount: number;
  direction: 'from_carrier' | 'to_carrier';
  paymentMethod: string;
  paymentReference?: string;
  notes?: string;
  settlementIds?: string[];
  movementIds?: string[];
  createdBy?: string;
}): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin.rpc('register_carrier_payment', {
      p_store_id: payment.storeId,
      p_carrier_id: payment.carrierId,
      p_amount: payment.amount,
      p_direction: payment.direction,
      p_payment_method: payment.paymentMethod,
      p_payment_reference: payment.paymentReference || null,
      p_notes: payment.notes || null,
      p_settlement_ids: payment.settlementIds || null,
      p_movement_ids: payment.movementIds || null,
      p_created_by: payment.createdBy || null
    });

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error registering payment:', error);
      throw new Error(`Error al registrar pago: ${error.message}`);
    }

    logger.info('BACKEND', `✅ [CARRIER ACCOUNTS] Registered payment ${data} for carrier ${payment.carrierId}`);
    return data;
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in registerCarrierPayment:', error);
    throw error;
  }
}

/**
 * Get payment records for a carrier
 *
 * @param storeId - Store UUID
 * @param carrierId - Optional carrier filter
 * @param status - Optional status filter
 * @returns Array of payment records
 */
export async function getPaymentRecords(
  storeId: string,
  carrierId?: string,
  status?: string
): Promise<PaymentRecord[]> {
  try {
    let query = supabaseAdmin
      .from('carrier_payment_records')
      .select('*')
      .eq('store_id', storeId)
      .order('payment_date', { ascending: false });

    if (carrierId) {
      query = query.eq('carrier_id', carrierId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error fetching payment records:', error);
      throw new Error(`Error al obtener registros de pago: ${error.message}`);
    }

    return data || [];
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in getPaymentRecords:', error);
    throw error;
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Check if movements exist for an order
 *
 * Useful to prevent duplicate creation.
 *
 * @param orderId - Order UUID
 * @returns True if movements exist
 */
export async function hasMovementsForOrder(orderId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('carrier_account_movements')
      .select('id')
      .eq('order_id', orderId)
      .limit(1);

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error checking movements:', error);
      return false;
    }

    return (data && data.length > 0) || false;
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in hasMovementsForOrder:', error);
    return false;
  }
}

/**
 * Backfill movements for existing delivered orders
 *
 * This should be run once after migration 065 to populate
 * movements for historical orders.
 *
 * IMPORTANT: Process in batches (1000 at a time) to avoid timeouts.
 *
 * @param storeId - Optional store filter (null = all stores)
 * @returns Number of orders and movements processed
 */
export async function backfillCarrierMovements(storeId?: string): Promise<{
  orders_processed: number;
  movements_created: number;
}> {
  try {
    logger.info('BACKEND', `🔄 [CARRIER ACCOUNTS] Starting backfill for store ${storeId || 'ALL'}...`);

    const { data, error } = await supabaseAdmin.rpc('backfill_carrier_movements', {
      p_store_id: storeId || null
    });

    if (error) {
      logger.error('BACKEND', '❌ [CARRIER ACCOUNTS] Error in backfill:', error);
      throw new Error(`Error al rellenar movimientos: ${error.message}`);
    }

    const result = Array.isArray(data) ? data[0] : data;

    logger.info('BACKEND', `✅ [CARRIER ACCOUNTS] Backfill complete:`, result);

    return {
      orders_processed: result?.orders_processed || 0,
      movements_created: result?.movements_created || 0
    };
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CARRIER ACCOUNTS] Exception in backfillCarrierMovements:', error);
    throw error;
  }
}

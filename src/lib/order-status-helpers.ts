/**
 * Order status helpers: dual-write bridge during the sleeves_status
 * transition window.
 *
 * Why:
 *   - Migration 148b is live: orders.status (enum) is the new source of truth.
 *   - Migration 148c has NOT run yet: orders.sleeves_status (legacy VARCHAR)
 *     still exists and is still read by parts of the codebase that have not
 *     been swept yet.
 *   - Until the sweep is complete, every write path MUST update both columns
 *     atomically (same Supabase update call) so rollbacks and mixed deploys
 *     stay consistent.
 *
 * Post 148c cutover plan:
 *   1. FASE 2: replace every direct .update({ sleeves_status: ... }) or
 *      .eq('sleeves_status', ...) call site with these helpers.
 *   2. Deploy, monitor 24h.
 *   3. Apply migration 148c (drops sleeves_status).
 *   4. Drop sleeves_status writes from updateOrderStatus().
 *   5. Drop sleeves_status fallback from readOrderStatus().
 *   6. Delete this file (all consumers can switch to plain supabase.update).
 *
 * This file intentionally has zero `any`, zero `@ts-ignore`, and no runtime
 * dependencies beyond the passed-in Supabase client.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type OrderStatus,
  type LegacyOrderStatus,
  legacyStatusToEnum,
} from './status';

/**
 * Extra fields that commonly move together with a status change. Typed
 * narrowly to prevent callers from sneaking in arbitrary column names.
 */
export interface OrderStatusExtra {
  delivered_at?: string | null;
  reconciled_at?: string | null;
  settled_at?: string | null;
  cancelled_at?: string | null;
  shipped_at?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  confirmation_method?: string | null;
  failed_reason?: string | null;
  courier_notes?: string | null;
  courier_id?: string | null;
  carrier_settlement_id?: string | null;
  payment_status?: 'pending' | 'collected' | 'failed' | null;
}

interface OrderRow {
  status?: OrderStatus | LegacyOrderStatus | null;
  sleeves_status?: string | null;
}

interface UpdateResult {
  ok: boolean;
  error?: string;
}

/**
 * Dual-write a new status to an order. Writes BOTH `status` (enum source of
 * truth) and `sleeves_status` (legacy VARCHAR) in the same update call so the
 * row never sees a half-migrated state.
 *
 * Extra fields (delivered_at, reconciled_at, settled_at, etc.) ride on the
 * same update to preserve atomicity. If you only want to update extras
 * without touching the status, pass `status = null` and supply them directly
 * via supabase.update() instead of this helper.
 *
 * @param client      Supabase client. Server code should use the admin
 *                    client; frontend code uses the RLS-scoped client.
 * @param orderId     UUID of the order to update.
 * @param status      Canonical OrderStatus. Legacy values are rejected.
 * @param extra       Optional column updates that ride the same write.
 */
export async function updateOrderStatus(
  client: SupabaseClient,
  orderId: string,
  status: OrderStatus,
  extra: OrderStatusExtra = {},
): Promise<UpdateResult> {
  if (!orderId) {
    return { ok: false, error: 'orderId is required' };
  }

  const payload: Record<string, unknown> = {
    status,
    sleeves_status: status,
    ...extra,
  };

  const { error } = await client
    .from('orders')
    .update(payload)
    .eq('id', orderId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Canonical read: prefer `status` (enum) and fall back to `sleeves_status`
 * normalized through legacyStatusToEnum(). Returns `null` when both columns
 * are absent (rare, means the row is truly untouched since migration 017).
 */
export function readOrderStatus(order: OrderRow | null | undefined): OrderStatus | null {
  if (!order) {
    return null;
  }
  if (order.status) {
    // Legacy values may still land here for a short window until 148c.
    // Normalize defensively.
    return legacyStatusToEnum(order.status);
  }
  if (order.sleeves_status) {
    return legacyStatusToEnum(order.sleeves_status);
  }
  return null;
}

/**
 * Build a Supabase filter that matches the given status against both
 * `status` and `sleeves_status`. Use this in routes / services that accept a
 * status query param so filters keep working across the transition.
 *
 * Returns a tagged union instead of mutating the query, so the caller
 * decides whether to use .or() (multi column match) or .eq() (single column).
 * This avoids accidentally coupling the helper to a specific query-builder
 * state.
 *
 * Example:
 *   const match = buildStatusFilter('delivered');
 *   query = query.or(match.orExpression);
 */
export function buildStatusFilter(status: OrderStatus): {
  orExpression: string;
  enumValue: OrderStatus;
  legacyValue: string;
} {
  return {
    orExpression: `status.eq.${status},sleeves_status.eq.${status}`,
    enumValue: status,
    legacyValue: status,
  };
}

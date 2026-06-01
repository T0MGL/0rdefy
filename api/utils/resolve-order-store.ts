// ================================================================
// resolveOrderStore
// ================================================================
// A mutation scoped to a specific order row must operate under the
// store that OWNS that order, never under whatever store happens to be
// active in the caller's tab. An owner with several stores can hold a
// stale X-Store-ID in one tab while acting on an order from another of
// their stores; matching the order against that wrong store returns zero
// rows and surfaces as a misleading 404 ("order not found").
//
// This resolver reconciles the header store with the order's real store:
//   - header store === order store  -> use it (fast path, no extra query)
//   - header store !== order store, but the caller has active access to
//     the order's owning store      -> use the order's store (auto-heal)
//   - caller has no access to the    -> mismatch: caller must not operate
//     order's owning store              on this order
//   - order does not exist anywhere  -> not found
//
// Cross-store auto-heal is gated strictly on user_stores access, so it
// never widens the caller's reach: it only lets them act on orders that
// belong to stores they already legitimately manage.

import { supabaseAdmin } from '../db/connection';

export type ResolveOrderStoreResult =
  // healed=true means the resolved store differs from the header store. The
  // caller MUST re-check the required permission against resolvedRole, since
  // the upstream permission middleware evaluated the role of the HEADER store,
  // not this one. resolvedRole is the caller's role in the resolved store.
  | { outcome: 'ok'; storeId: string; healed: boolean; resolvedRole: string | null }
  | { outcome: 'not_found' }
  | { outcome: 'mismatch'; orderStoreId: string };

interface ResolveOrderStoreArgs {
  orderId: string;
  headerStoreId: string;
  userId?: string;
  // Shopify (webhook) sessions are not user-scoped; the header store is
  // already proven to own the integration upstream, so trust it as-is.
  isShopifySession?: boolean;
  // Delete/restore flows must resolve soft-deleted orders too. Most
  // mutation flows only act on live orders, so deleted rows are excluded
  // by default and surface as not_found.
  includeDeleted?: boolean;
}

export async function resolveOrderStore({
  orderId,
  headerStoreId,
  userId,
  isShopifySession = false,
  includeDeleted = false,
}: ResolveOrderStoreArgs): Promise<ResolveOrderStoreResult> {
  let query = supabaseAdmin
    .from('orders')
    .select('store_id')
    .eq('id', orderId);

  if (!includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data: order, error } = await query.single();

  if (error || !order) {
    return { outcome: 'not_found' };
  }

  const orderStoreId = order.store_id as string;

  // Fast path: header already points at the owning store. The upstream
  // permission middleware already validated the role for this store.
  if (orderStoreId === headerStoreId) {
    return { outcome: 'ok', storeId: orderStoreId, healed: false, resolvedRole: null };
  }

  // Shopify sessions carry a store proven upstream; do not auto-heal.
  if (isShopifySession || !userId) {
    return { outcome: 'mismatch', orderStoreId };
  }

  // Header points at a different store than the order. Auto-heal only if
  // the caller actually manages the order's owning store. Return the role
  // so the caller can re-authorize against the resolved store (the upstream
  // middleware authorized against the header store, which is the wrong one).
  const { data: access, error: accessError } = await supabaseAdmin
    .from('user_stores')
    .select('role')
    .eq('user_id', userId)
    .eq('store_id', orderStoreId)
    .eq('is_active', true)
    .single();

  if (accessError || !access) {
    return { outcome: 'mismatch', orderStoreId };
  }

  return {
    outcome: 'ok',
    storeId: orderStoreId,
    healed: true,
    resolvedRole: (access.role as string) ?? null,
  };
}

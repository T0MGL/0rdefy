/**
 * Warehouse Service
 * Frontend service for warehouse picking and packing operations
 *
 * UPDATED: Jan 2026 - Full variant support (Migration 108)
 * All operations now properly handle product variants (bundles and variations)
 */

import apiClient from './api.client';

const BASE_URL = '/warehouse';

// ============================================================================
// HELPER: Generate composite key for product+variant combinations
// ============================================================================

/**
 * Generates a unique key for a product+variant combination
 * Used for Maps, availability lookups, and optimistic updates
 * Handles null, undefined, empty string, and whitespace-only variantId consistently
 */
export function getProductVariantKey(productId: string, variantId?: string | null): string {
  const normalizedVariantId = variantId && variantId.trim() ? variantId.trim() : null;
  return normalizedVariantId ? `${productId}|${normalizedVariantId}` : productId;
}

/**
 * Parses a composite key back to product_id and variant_id
 */
export function parseProductVariantKey(key: string): { productId: string; variantId: string | null } {
  if (key.includes('|')) {
    const [productId, variantId] = key.split('|');
    return { productId, variantId };
  }
  return { productId: key, variantId: null };
}

// ============================================================================
// INTERFACES - Updated with variant_id support
// ============================================================================

export interface PickingSession {
  id: string;
  code: string;
  status: 'picking' | 'packing' | 'completed';
  user_id: string | null;
  store_id: string;
  created_at: string;
  updated_at: string;
  last_activity_at?: string | null; // For staleness calculation
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
  variant_id?: string | null; // NEW: variant support (Migration 108)
  total_quantity_needed: number;
  quantity_picked: number;
  created_at: string;
  updated_at: string;
  product_name?: string;
  product_image?: string;
  product_sku?: string;
  variant_title?: string; // NEW: for display
  units_per_pack?: number; // NEW: for bundle display
  shelf_location?: string;
}

export interface PackingProgressItem {
  product_id: string;
  variant_id?: string | null; // NEW: variant support (Migration 108)
  product_name: string;
  product_image: string;
  quantity_needed: number;
  quantity_packed: number;
  unit_price?: number;
}

export interface OrderForPacking {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address?: string;
  address_reference?: string;
  neighborhood?: string;
  shipping_city?: string; // City for carrier coverage
  delivery_notes?: string;
  delivery_link_token?: string;
  carrier_id?: string;
  carrier_name?: string;
  cod_amount?: number;
  total_price?: number;
  total_discounts?: number;
  payment_method?: string;
  payment_gateway?: string; // From Shopify: 'cash_on_delivery', 'shopify_payments', etc.
  financial_status?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided';
  printed?: boolean;
  printed_at?: string;
  created_at?: string;
  items: PackingProgressItem[]; // Updated to use interface with variant_id
  is_complete: boolean;
}

export interface AvailableItem {
  product_id: string;
  variant_id?: string | null; // NEW: variant support (Migration 108)
  product_name: string;
  product_image: string;
  total_picked: number;
  total_packed: number;
  remaining: number;
}

export interface PackingListResponse {
  session: PickingSession;
  orders: OrderForPacking[];
  availableItems: AvailableItem[]; // Updated to use interface with variant_id
}

export interface ConfirmedOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  created_at: string;
  carrier_name?: string;
  total_items: number;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Gets all confirmed orders ready for preparation
 */
export async function getConfirmedOrders(): Promise<ConfirmedOrder[]> {
  const response = await apiClient.get<ConfirmedOrder[]>(`${BASE_URL}/orders/confirmed`);
  return response.data;
}

/**
 * Gets all active picking sessions
 */
export async function getActiveSessions(): Promise<PickingSession[]> {
  const response = await apiClient.get<PickingSession[]>(`${BASE_URL}/sessions/active`);
  return response.data;
}

/**
 * Creates a new picking session from confirmed orders
 */
export async function createSession(orderIds: string[]): Promise<PickingSession> {
  const response = await apiClient.post<PickingSession>(`${BASE_URL}/sessions`, {
    orderIds
  });
  return response.data;
}

/**
 * Gets the aggregated picking list for a session
 */
export async function getPickingList(sessionId: string): Promise<{
  items: PickingSessionItem[];
  orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
  }>;
}> {
  const response = await apiClient.get<{
    items: PickingSessionItem[];
    orders: Array<{
      id: string;
      order_number: string;
      customer_name: string;
    }>;
  }>(`${BASE_URL}/sessions/${sessionId}/picking-list`);
  return response.data;
}

/**
 * Updates picking progress for a specific product (with variant support)
 *
 * @param sessionId - The picking session ID
 * @param productId - The product ID
 * @param quantityPicked - Number of units picked
 * @param variantId - Optional variant ID for products with variants (Migration 108)
 */
export async function updatePickingProgress(
  sessionId: string,
  productId: string,
  quantityPicked: number,
  variantId?: string | null
): Promise<PickingSessionItem> {
  const response = await apiClient.post<PickingSessionItem>(
    `${BASE_URL}/sessions/${sessionId}/picking-progress`,
    {
      productId,
      quantityPicked,
      variantId: variantId || null // Explicitly send null if undefined
    }
  );
  return response.data;
}

/**
 * Finishes picking phase and transitions to packing
 */
export async function finishPicking(sessionId: string): Promise<PickingSession> {
  const response = await apiClient.post<PickingSession>(
    `${BASE_URL}/sessions/${sessionId}/finish-picking`
  );
  return response.data;
}

/**
 * Gets the packing list with order details and progress
 */
export async function getPackingList(sessionId: string): Promise<PackingListResponse> {
  const response = await apiClient.get<PackingListResponse>(
    `${BASE_URL}/sessions/${sessionId}/packing-list`
  );
  return response.data;
}

/**
 * Assigns one unit of a product to an order (packing) - with variant support
 *
 * @param sessionId - The picking session ID
 * @param orderId - The order ID to pack into
 * @param productId - The product ID being packed
 * @param variantId - Optional variant ID for products with variants (Migration 108)
 */
export async function updatePackingProgress(
  sessionId: string,
  orderId: string,
  productId: string,
  variantId?: string | null
): Promise<void> {
  await apiClient.post(
    `${BASE_URL}/sessions/${sessionId}/packing-progress`,
    {
      orderId,
      productId,
      variantId: variantId || null // Explicitly send null if undefined
    }
  );
}

/**
 * Completes a picking session
 */
export async function completeSession(sessionId: string): Promise<PickingSession> {
  const response = await apiClient.post<PickingSession>(
    `${BASE_URL}/sessions/${sessionId}/complete`
  );
  return response.data;
}

/**
 * Abandons a picking session and restores orders to confirmed status
 */
export async function abandonSession(sessionId: string, reason?: string): Promise<{
  success: boolean;
  session_id: string;
  session_code: string;
  orders_restored: number;
  total_orders: number;
  abandoned_at: string;
  reason: string;
}> {
  const response = await apiClient.post(
    `${BASE_URL}/sessions/${sessionId}/abandon`,
    { reason }
  );
  return response.data;
}

/**
 * Removes a single order from a picking session
 */
export async function removeOrderFromSession(sessionId: string, orderId: string): Promise<{
  success: boolean;
  order_id: string;
  order_number: string;
  remaining_orders: number;
  session_abandoned: boolean;
}> {
  const response = await apiClient.delete(
    `${BASE_URL}/sessions/${sessionId}/orders/${orderId}`
  );
  return response.data;
}

/**
 * Gets stale sessions that may need attention
 */
export async function getStaleSessions(): Promise<Array<{
  id: string;
  code: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_activity_at?: string;
  inactive_hours: number;
  staleness_level: 'OK' | 'WARNING' | 'CRITICAL';
}>> {
  const response = await apiClient.get(`${BASE_URL}/sessions/stale`);
  return response.data;
}

/**
 * Auto-pack all items for all orders in a session with a single call
 * This dramatically reduces warehouse operation time from minutes to seconds
 */
export async function autoPackSession(sessionId: string): Promise<{
  success: boolean;
  session_id: string;
  orders_packed: number;
  items_packed: number;
  total_units: number;
  packed_at: string;
}> {
  const response = await apiClient.post(`${BASE_URL}/sessions/${sessionId}/auto-pack`);
  return response.data;
}

/**
 * Pack all items for a single order in one call
 * Useful for the "Empacar" button on individual order cards
 */
export async function packAllItemsForOrder(sessionId: string, orderId: string): Promise<{
  success: boolean;
  session_id: string;
  order_id: string;
  items_packed: number;
  total_units: number;
  is_complete: boolean;
  packed_at: string;
}> {
  const response = await apiClient.post(`${BASE_URL}/sessions/${sessionId}/pack-order/${orderId}`);
  return response.data;
}

/**
 * Warehouse Service
 * Frontend service for warehouse picking and packing operations
 */

import apiClient from './api.client';

const BASE_URL = '/warehouse';

export interface PickingSession {
  id: string;
  code: string;
  status: 'picking' | 'packing' | 'completed';
  user_id: string | null;
  store_id: string;
  created_at: string;
  updated_at: string;
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
  total_quantity_needed: number;
  quantity_picked: number;
  created_at: string;
  updated_at: string;
  product_name?: string;
  product_image?: string;
  product_sku?: string;
  shelf_location?: string;
}

export interface OrderForPacking {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address?: string;
  address_reference?: string;
  neighborhood?: string;
  delivery_notes?: string;
  delivery_link_token?: string;
  carrier_id?: string;
  carrier_name?: string;
  cod_amount?: number;
  payment_method?: string;
  financial_status?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided';
  printed?: boolean;
  printed_at?: string;
  items: Array<{
    product_id: string;
    product_name: string;
    product_image: string;
    quantity_needed: number;
    quantity_packed: number;
  }>;
  is_complete: boolean;
}

export interface PackingListResponse {
  session: PickingSession;
  orders: OrderForPacking[];
  availableItems: Array<{
    product_id: string;
    product_name: string;
    product_image: string;
    total_picked: number;
    total_packed: number;
    remaining: number;
  }>;
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
 * Updates picking progress for a specific product
 */
export async function updatePickingProgress(
  sessionId: string,
  productId: string,
  quantityPicked: number
): Promise<PickingSessionItem> {
  const response = await apiClient.post<PickingSessionItem>(
    `${BASE_URL}/sessions/${sessionId}/picking-progress`,
    { productId, quantityPicked }
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
 * Assigns one unit of a product to an order (packing)
 */
export async function updatePackingProgress(
  sessionId: string,
  orderId: string,
  productId: string
): Promise<void> {
  await apiClient.post(
    `${BASE_URL}/sessions/${sessionId}/packing-progress`,
    { orderId, productId }
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

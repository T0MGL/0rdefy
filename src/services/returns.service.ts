/**
 * Returns Service - Frontend
 * API calls for return/refund processing
 *
 * @author Bright Idea
 * @date 2025-12-02
 */

import { apiClient } from './api.client';

export interface ReturnSession {
  id: string;
  store_id: string;
  session_code: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  total_orders: number;
  processed_orders: number;
  total_items: number;
  accepted_items: number;
  rejected_items: number;
  notes?: string;
  created_at: string;
  completed_at?: string;
  created_by: string;
}

export interface ReturnSessionItem {
  id: string;
  session_id: string;
  order_id: string;
  product_id: string;
  quantity_expected: number;
  quantity_received: number;
  quantity_accepted: number;
  quantity_rejected: number;
  rejection_reason?: 'damaged' | 'defective' | 'incomplete' | 'wrong_item' | 'other';
  rejection_notes?: string;
  unit_cost: number;
  created_at: string;
  processed_at?: string;
  product?: {
    id: string;
    name: string;
    sku: string;
    image_url?: string;
    stock: number;
  };
}

export interface EligibleOrder {
  id: string;
  order_number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  total_price: number;
  items_count: number;
  delivered_at?: string;
  shipped_at?: string;
}

export interface ReturnSessionDetail extends ReturnSession {
  orders: Array<{
    id: string;
    session_id: string;
    order_id: string;
    original_status: string;
    processed: boolean;
    processed_at?: string;
    order: any;
  }>;
  items: ReturnSessionItem[];
}

export interface ReturnStats {
  total_sessions: number;
  total_orders: number;
  total_items_accepted: number;
  total_items_rejected: number;
  acceptance_rate: string;
}

/**
 * Get orders eligible for return (delivered, shipped, cancelled)
 */
export async function getEligibleOrders(): Promise<EligibleOrder[]> {
  const response = await apiClient.get('/api/returns/eligible-orders');
  return response.data;
}

/**
 * Get all return sessions
 */
export async function getReturnSessions(): Promise<ReturnSession[]> {
  const response = await apiClient.get('/api/returns/sessions');
  return response.data;
}

/**
 * Get return session details
 */
export async function getReturnSession(sessionId: string): Promise<ReturnSessionDetail> {
  const response = await apiClient.get(`/api/returns/sessions/${sessionId}`);
  return response.data;
}

/**
 * Create a new return session
 */
export async function createReturnSession(
  orderIds: string[],
  notes?: string
): Promise<ReturnSession> {
  const response = await apiClient.post('/api/returns/sessions', {
    order_ids: orderIds,
    notes,
  });
  return response.data;
}

/**
 * Update return item (accept/reject quantities)
 */
export async function updateReturnItem(
  itemId: string,
  updates: {
    quantity_received?: number;
    quantity_accepted?: number;
    quantity_rejected?: number;
    rejection_reason?: string;
    rejection_notes?: string;
  }
): Promise<ReturnSessionItem> {
  const response = await apiClient.patch(`/api/returns/items/${itemId}`, updates);
  return response.data;
}

/**
 * Complete return session
 */
export async function completeReturnSession(sessionId: string): Promise<any> {
  const response = await apiClient.post(`/api/returns/sessions/${sessionId}/complete`);
  return response.data;
}

/**
 * Cancel return session
 */
export async function cancelReturnSession(sessionId: string): Promise<void> {
  await apiClient.post(`/api/returns/sessions/${sessionId}/cancel`);
}

/**
 * Get return statistics
 */
export async function getReturnStats(): Promise<ReturnStats> {
  const response = await apiClient.get('/api/returns/stats');
  return response.data;
}

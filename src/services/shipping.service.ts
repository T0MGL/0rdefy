/**
 * Shipping Service (Frontend)
 * Handles order dispatch to couriers
 */

import apiClient from './api.client';

const BASE_URL = '/shipping';

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
}

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

export interface ShipmentResult {
  shipment_id: string | null;
  order_id: string;
  order_number: string;
  success: boolean;
  error_message: string | null;
}

export interface BatchDispatchResponse {
  total: number;
  succeeded: number;
  failed: number;
  results: ShipmentResult[];
}

/**
 * Gets all orders ready to ship (status: ready_to_ship)
 */
export async function getReadyToShipOrders(): Promise<ReadyToShipOrder[]> {
  const response = await apiClient.get<ReadyToShipOrder[]>(`${BASE_URL}/ready-to-ship`);
  return response.data;
}

/**
 * Dispatches a single order to courier
 */
export async function dispatchOrder(orderId: string, notes?: string): Promise<Shipment> {
  const response = await apiClient.post<Shipment>(`${BASE_URL}/dispatch`, {
    orderId,
    notes
  });
  return response.data;
}

/**
 * Dispatches multiple orders to couriers at once
 */
export async function dispatchBatch(
  orderIds: string[],
  notes?: string
): Promise<BatchDispatchResponse> {
  const response = await apiClient.post<BatchDispatchResponse>(`${BASE_URL}/dispatch-batch`, {
    orderIds,
    notes
  });
  return response.data;
}

/**
 * Gets shipment history for a specific order
 */
export async function getOrderShipments(orderId: string): Promise<Shipment[]> {
  const response = await apiClient.get<Shipment[]>(`${BASE_URL}/order/${orderId}`);
  return response.data;
}

/**
 * Gets shipment history for the store (paginated)
 */
export async function getShipmentHistory(
  limit: number = 50,
  offset: number = 0
): Promise<{ shipments: Shipment[]; total: number }> {
  const response = await apiClient.get<{ shipments: Shipment[]; total: number }>(
    `${BASE_URL}/history?limit=${limit}&offset=${offset}`
  );
  return response.data;
}

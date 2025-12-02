// ================================================================
// INVENTORY SERVICE
// ================================================================
// API client for inventory movements and stock management
// ================================================================

import apiClient from './api.client';

export interface InventoryMovement {
  id: string;
  store_id: string;
  product_id: string;
  order_id?: string;
  quantity_change: number;
  stock_before: number;
  stock_after: number;
  movement_type: 'order_ready' | 'order_cancelled' | 'order_reverted' | 'manual_adjustment';
  order_status_from?: string;
  order_status_to?: string;
  notes?: string;
  created_at: string;
  products?: {
    id: string;
    name: string;
    sku?: string;
    image_url?: string;
  };
  orders?: {
    id: string;
    customer_first_name?: string;
    customer_last_name?: string;
    customer_phone?: string;
  };
}

export interface InventoryMovementsResponse {
  data: InventoryMovement[];
  count: number;
  limit: number;
  offset: number;
}

export interface InventorySummary {
  total_movements: number;
  by_type: {
    order_ready: number;
    order_cancelled: number;
    order_reverted: number;
    manual_adjustment: number;
  };
  total_decrements: number;
  total_increments: number;
  net_change: number;
}

export interface AdjustInventoryRequest {
  product_id: string;
  quantity_change: number;
  notes?: string;
}

export interface AdjustInventoryResponse {
  success: boolean;
  product_id: string;
  product_name: string;
  stock_before: number;
  stock_after: number;
  quantity_change: number;
  movement: InventoryMovement;
}

export const inventoryService = {
  /**
   * Get all inventory movements with optional filters
   */
  async getMovements(params?: {
    product_id?: string;
    date_from?: string;
    date_to?: string;
    movement_type?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<InventoryMovementsResponse> {
    const queryParams = new URLSearchParams();

    if (params?.product_id) queryParams.append('product_id', params.product_id);
    if (params?.date_from) queryParams.append('date_from', params.date_from);
    if (params?.date_to) queryParams.append('date_to', params.date_to);
    if (params?.movement_type) queryParams.append('movement_type', params.movement_type);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const response = await apiClient.get(`/inventory/movements?${queryParams.toString()}`);
    return response.data;
  },

  /**
   * Get summary statistics for inventory movements
   */
  async getSummary(params?: {
    date_from?: string;
    date_to?: string;
  }): Promise<InventorySummary> {
    const queryParams = new URLSearchParams();

    if (params?.date_from) queryParams.append('date_from', params.date_from);
    if (params?.date_to) queryParams.append('date_to', params.date_to);

    const response = await apiClient.get(`/inventory/movements/summary?${queryParams.toString()}`);
    return response.data;
  },

  /**
   * Get movements for a specific product
   */
  async getProductMovements(
    productId: string,
    params?: {
      limit?: number;
      offset?: number;
    }
  ): Promise<InventoryMovementsResponse> {
    const queryParams = new URLSearchParams();

    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const response = await apiClient.get(
      `/inventory/movements/product/${productId}?${queryParams.toString()}`
    );
    return response.data;
  },

  /**
   * Manual inventory adjustment
   */
  async adjustInventory(data: AdjustInventoryRequest): Promise<AdjustInventoryResponse> {
    const response = await apiClient.post('/inventory/adjust', data);
    return response.data;
  },
};

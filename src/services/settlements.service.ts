// ================================================================
// SETTLEMENTS SERVICE
// ================================================================
// Handles daily cash reconciliation operations with backend API
// ================================================================

import { DailySettlement } from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};

// ================================================================
// GET ALL SETTLEMENTS
// ================================================================
export const getSettlements = async (params?: {
  date?: string;
  carrier_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: DailySettlement[]; pagination: any }> => {
  const queryParams = new URLSearchParams();
  if (params?.date) queryParams.append('date', params.date);
  if (params?.carrier_id) queryParams.append('carrier_id', params.carrier_id);
  if (params?.status) queryParams.append('status', params.status);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());

  const response = await fetch(
    `${API_BASE}/api/settlements?${queryParams.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch settlements');
  }

  return response.json();
};

// ================================================================
// GET TODAY'S SETTLEMENT
// ================================================================
export const getTodaySettlement = async (params?: {
  carrier_id?: string;
}): Promise<{
  settlement: DailySettlement | null;
  delivered_orders: any[];
  expected_cash: number;
}> => {
  const queryParams = new URLSearchParams();
  if (params?.carrier_id) queryParams.append('carrier_id', params.carrier_id);

  const response = await fetch(
    `${API_BASE}/api/settlements/today?${queryParams.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch today settlement');
  }

  return response.json();
};

// ================================================================
// GET SINGLE SETTLEMENT WITH ORDERS
// ================================================================
export const getSettlementById = async (id: string): Promise<DailySettlement & { orders: any[] }> => {
  const response = await fetch(`${API_BASE}/api/settlements/${id}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch settlement');
  }

  return response.json();
};

// ================================================================
// CREATE SETTLEMENT
// ================================================================
export const createSettlement = async (
  data: {
    settlement_date: string;
    carrier_id?: string;
    order_ids?: string[];
    notes?: string;
  }
): Promise<DailySettlement> => {
  const response = await fetch(`${API_BASE}/api/settlements`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create settlement');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// UPDATE SETTLEMENT
// ================================================================
export const updateSettlement = async (
  id: string,
  data: Partial<DailySettlement>
): Promise<DailySettlement> => {
  const response = await fetch(`${API_BASE}/api/settlements/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update settlement');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// COMPLETE SETTLEMENT (CLOSE CASH REGISTER)
// ================================================================
export const completeSettlement = async (
  id: string,
  data: {
    collected_cash: number;
    notes?: string;
  }
): Promise<DailySettlement> => {
  const response = await fetch(`${API_BASE}/api/settlements/${id}/complete`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to complete settlement');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// GET SETTLEMENT STATISTICS
// ================================================================
export const getSettlementStats = async (params?: {
  start_date?: string;
  end_date?: string;
}): Promise<{
  total_expected: number;
  total_collected: number;
  total_difference: number;
  pending_count: number;
  completed_count: number;
  with_issues_count: number;
}> => {
  const queryParams = new URLSearchParams();
  if (params?.start_date) queryParams.append('start_date', params.start_date);
  if (params?.end_date) queryParams.append('end_date', params.end_date);

  const response = await fetch(
    `${API_BASE}/api/settlements/stats/summary?${queryParams.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch settlement stats');
  }

  return response.json();
};

// ================================================================
// DELETE SETTLEMENT
// ================================================================
export const deleteSettlement = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/api/settlements/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete settlement');
  }
};

// ================================================================
// EXPORT ALL
// ================================================================
export const settlementsService = {
  getAll: getSettlements,
  getToday: getTodaySettlement,
  getById: getSettlementById,
  create: createSettlement,
  update: updateSettlement,
  complete: completeSettlement,
  getStats: getSettlementStats,
  delete: deleteSettlement,
};

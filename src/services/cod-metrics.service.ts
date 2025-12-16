// ================================================================
// COD METRICS SERVICE
// ================================================================
// Handles COD analytics and metrics with backend API
// ================================================================

import { CODMetrics } from '@/types';

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
// GET COD METRICS
// ================================================================
export const getCODMetrics = async (params?: {
  start_date?: string;
  end_date?: string;
}): Promise<CODMetrics> => {
  const queryParams = new URLSearchParams();
  if (params?.start_date) queryParams.append('start_date', params.start_date);
  if (params?.end_date) queryParams.append('end_date', params.end_date);

  const response = await fetch(
    `${API_BASE}/api/cod-metrics?${queryParams.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch COD metrics');
  }

  return response.json();
};

// ================================================================
// GET DAILY BREAKDOWN
// ================================================================
export const getCODDailyBreakdown = async (params?: {
  days?: number;
}): Promise<{
  data: Array<{
    date: string;
    total_orders: number;
    confirmed: number;
    delivered: number;
    paid: number;
    revenue: number;
    collected: number;
  }>;
  period: {
    start_date: string;
    end_date: string;
    days: number;
  };
}> => {
  const queryParams = new URLSearchParams();
  if (params?.days) queryParams.append('days', params.days.toString());

  const response = await fetch(
    `${API_BASE}/api/cod-metrics/daily?${queryParams.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch daily breakdown');
  }

  return response.json();
};

// ================================================================
// GET METRICS BY CARRIER
// ================================================================
export const getCODMetricsByCarrier = async (): Promise<{
  data: Array<{
    carrier_id: string;
    carrier_name: string;
    total_orders: number;
    delivered: number;
    failed: number;
    in_delivery: number;
    total_attempts: number;
    success_rate: number;
    avg_attempts: number;
  }>;
}> => {
  const response = await fetch(`${API_BASE}/api/cod-metrics/by-carrier`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch carrier metrics');
  }

  return response.json();
};

// ================================================================
// EXPORT ALL
// ================================================================
export const codMetricsService = {
  getMetrics: getCODMetrics,
  getDailyBreakdown: getCODDailyBreakdown,
  getByCarrier: getCODMetricsByCarrier,
};

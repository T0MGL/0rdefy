import { DashboardOverview, ChartData, Product, ConfirmationMetrics } from '@/types';

const API_BASE_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api`;

// Valores por defecto cuando no hay datos
const defaultOverview: DashboardOverview = {
  totalOrders: 0,
  revenue: 0,
  costs: 0,
  marketing: 0,
  adSpend: 0,
  adRevenue: 0,
  roi: 0,
  conversionRate: 0,
  averageOrderValue: 0,
  deliveryRate: 0,
  profitMargin: 0,
  netProfit: 0,
  costPerOrder: 0,
};

const defaultConfirmationMetrics: ConfirmationMetrics = {
  total: 0,
  confirmed: 0,
  pending: 0,
  rejected: 0,
  confirmationRate: 0,
};

// Helper function to get headers with store ID
const getHeaders = () => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');

  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Store-ID': storeId || '',
  };
};

export const analyticsService = {
  getOverview: async (params?: { startDate?: string; endDate?: string }): Promise<DashboardOverview> => {
    try {
      const queryParams = new URLSearchParams();
      if (params?.startDate) queryParams.append('startDate', params.startDate);
      if (params?.endDate) queryParams.append('endDate', params.endDate);

      const url = `${API_BASE_URL}/analytics/overview${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await fetch(url, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result.data || defaultOverview;
    } catch (error) {
      console.error('Error loading overview:', error);
      return defaultOverview;
    }
  },

  getChartData: async (days: number = 7, params?: { startDate?: string; endDate?: string }): Promise<ChartData[]> => {
    try {
      const queryParams = new URLSearchParams();
      if (params?.startDate && params?.endDate) {
        queryParams.append('startDate', params.startDate);
        queryParams.append('endDate', params.endDate);
      } else {
        queryParams.append('days', days.toString());
      }

      const response = await fetch(`${API_BASE_URL}/analytics/chart?${queryParams.toString()}`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('Error loading chart data:', error);
      return [];
    }
  },

  getConfirmationMetrics: async (): Promise<ConfirmationMetrics> => {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/confirmation-metrics`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result.data || defaultConfirmationMetrics;
    } catch (error) {
      console.error('Error loading confirmation metrics:', error);
      return defaultConfirmationMetrics;
    }
  },

  getTopProducts: async (limit: number = 5): Promise<Product[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/top-products?limit=${limit}`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('Error loading top products:', error);
      return [];
    }
  },

  getOrderStatusDistribution: async (): Promise<any[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/order-status-distribution`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('Error loading order status distribution:', error);
      return [];
    }
  },
};

import { DashboardOverview, ChartData, Product, ConfirmationMetrics } from '@/types';
import { logger } from '@/utils/logger';

const API_BASE_URL = `${import.meta.env.VITE_API_URL || 'https://api.ordefy.io'}/api`;

const defaultOverview: DashboardOverview = {
  totalOrders: 0,
  revenue: 0,
  productCosts: 0,
  costs: 0,
  deliveryCosts: 0,
  gasto_publicitario: 0,
  grossProfit: 0,
  grossMargin: 0,
  netProfit: 0,
  netMargin: 0,
  profitMargin: 0,
  realRevenue: 0,
  realCosts: 0,
  realDeliveryCosts: 0,
  realNetProfit: 0,
  realProfitMargin: 0,
  roi: 0,
  roas: 0,
  deliveryRate: 0,
  taxCollected: 0,
  taxRate: 0,
  costPerOrder: 0,
  averageOrderValue: 0,
};

const defaultConfirmationMetrics: ConfirmationMetrics = {
  totalPending: 0,
  totalConfirmed: 0,
  confirmationRate: 0,
  avgConfirmationTime: 0,
  confirmationsToday: 0,
  pendingToday: 0,
};

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
  getOverview: async (params?: { startDate?: string; endDate?: string }, signal?: AbortSignal): Promise<DashboardOverview> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const url = `${API_BASE_URL}/analytics/overview${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders(),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return { ...defaultOverview, ...result.data };
  },

  getChartData: async (days: number = 7, params?: { startDate?: string; endDate?: string }, signal?: AbortSignal): Promise<ChartData[]> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate && params?.endDate) {
      queryParams.append('startDate', params.startDate);
      queryParams.append('endDate', params.endDate);
    } else {
      queryParams.append('days', days.toString());
    }

    const response = await fetch(`${API_BASE_URL}/analytics/chart?${queryParams.toString()}`, {
      headers: getHeaders(),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || [];
  },

  getConfirmationMetrics: async (params?: { startDate?: string; endDate?: string }): Promise<ConfirmationMetrics> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const url = `${API_BASE_URL}/analytics/confirmation-metrics${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return { ...defaultConfirmationMetrics, ...result.data };
  },

  getTopProducts: async (limit: number = 5, params?: { startDate?: string; endDate?: string }): Promise<Product[]> => {
    const queryParams = new URLSearchParams();
    queryParams.append('limit', limit.toString());
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const response = await fetch(`${API_BASE_URL}/analytics/top-products?${queryParams.toString()}`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || [];
  },

  getOrderStatusDistribution: async (params?: { startDate?: string; endDate?: string }): Promise<OrderStatusItem[]> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const url = `${API_BASE_URL}/analytics/order-status-distribution${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || [];
  },

  getCashProjection: async (lookbackDays: number = 30): Promise<CashProjection | null> => {
    const queryParams = new URLSearchParams();
    queryParams.append('lookbackDays', lookbackDays.toString());

    const response = await fetch(`${API_BASE_URL}/analytics/cash-projection?${queryParams.toString()}`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || null;
  },

  getCashFlowTimeline: async (periodType: 'day' | 'week' = 'week'): Promise<CashFlowTimeline | null> => {
    const queryParams = new URLSearchParams();
    queryParams.append('periodType', periodType);

    const response = await fetch(`${API_BASE_URL}/analytics/cash-flow-timeline?${queryParams.toString()}`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || null;
  },

  getLogisticsMetrics: async (params?: { startDate?: string; endDate?: string }): Promise<LogisticsMetrics | null> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const url = `${API_BASE_URL}/analytics/logistics-metrics${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || null;
  },

  getReturnsMetrics: async (params?: { startDate?: string; endDate?: string }): Promise<ReturnsMetrics | null> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const url = `${API_BASE_URL}/analytics/returns-metrics${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || null;
  },

  getIncidentsMetrics: async (params?: { startDate?: string; endDate?: string }): Promise<IncidentsMetrics | null> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const url = `${API_BASE_URL}/analytics/incidents-metrics${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || null;
  },

  getShippingCosts: async (params?: { startDate?: string; endDate?: string }): Promise<ShippingCostsMetrics | null> => {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);

    const url = `${API_BASE_URL}/analytics/shipping-costs${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || null;
  },

  getNotificationData: async (signal?: AbortSignal): Promise<NotificationData | null> => {
    const response = await fetch(`${API_BASE_URL}/analytics/notification-data`, {
      headers: getHeaders(),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const result = await response.json();
    return result.data || null;
  },
};

export interface OrderStatusItem {
  status: string;
  count: number;
  percentage: number;
}

export interface CashProjection {
  projected_revenue: number;
  projected_costs: number;
  projected_profit: number;
  confidence: number;
  period_days: number;
}

export interface CashFlowTimeline {
  periods: Array<{
    period: string;
    revenue: number;
    costs: number;
    profit: number;
  }>;
}

export interface LogisticsMetrics {
  totalDispatched: number;
  dispatchedValue: number;
  failedRate: number;
  totalFailed: number;
  failedOrdersValue: number;
  doorRejectionRate: number;
  doorRejections: number;
  deliveryAttempts: number;
  cashCollectionRate: number;
  expectedCash: number;
  collectedCash: number;
  pendingCashAmount: number;
  pendingCollectionOrders: number;
  inTransitOrders: number;
  inTransitValue: number;
  avgDeliveryDays: number;
  avgDeliveryAttempts: number;
  costPerFailedAttempt: number;
  totalOrders: number;
  deliveredOrders: number;
}

export interface ReturnsMetrics {
  returnRate: number;
  returnedOrders: number;
  returnedValue: number;
  deliveredOrders: number;
  totalSessions: number;
  completedSessions: number;
  inProgressSessions: number;
  totalItemsProcessed: number;
  itemsAccepted: number;
  itemsRejected: number;
  acceptanceRate: number;
  rejectionReasons: Record<string, number>;
  totalOrders: number;
}

export interface IncidentsMetrics {
  totalIncidents: number;
  activeIncidents: number;
  resolvedIncidents: number;
  expiredIncidents: number;
  deliveredAfterIncident: number;
  cancelledIncidents: number;
  customerRejectedIncidents: number;
  successRate: number;
  avgRetries: number;
}

export interface NotificationData {
  orders: Array<{
    id: string;
    status: string;
    date: string;
    customer: string;
  }>;
  products: Array<{
    id: string;
    name: string;
    stock: number;
  }>;
  ads: Array<{
    id: string;
    status: string;
    name: string;
    investment: number;
    startDate: string;
    endDate: string;
  }>;
  carriers: Array<{
    id: string;
    name: string;
  }>;
}

export interface ShippingCostsMetrics {
  costs: {
    toPayCarriers: number;
    toPayCarriersOrders: number;
    paidToCarriers: number;
    pendingPayment: number;
    inTransit: number;
    inTransitOrders: number;
    readyToShip: number;
    readyToShipOrders: number;
    totalCommitted: number;
    grandTotal: number;
  };
  averages: {
    costPerDelivery: number;
    costPerSettledDelivery: number;
    deliveryDays: number;
  };
  performance: {
    successRate: number;
    totalDispatched: number;
    totalDelivered: number;
  };
  settlements: {
    total: number;
    paid: number;
    pending: number;
    partial: number;
    totalFees: number;
    totalPaid: number;
    totalPending: number;
  };
  carrierBreakdown: Array<{
    id: string;
    name: string;
    deliveredOrders: number;
    deliveredCosts: number;
    inTransitOrders: number;
    inTransitCosts: number;
    settledCosts: number;
    paidCosts: number;
    pendingPaymentCosts: number;
  }>;
  period: {
    start: string;
    end: string;
  };
}

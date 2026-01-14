import { DashboardOverview, ChartData, Product, ConfirmationMetrics } from '@/types';

const API_BASE_URL = `${import.meta.env.VITE_API_URL || 'https://api.ordefy.io'}/api`;

// Valores por defecto cuando no hay datos
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
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result = await response.json();
      // Merge with defaults to ensure all fields are present
      return { ...defaultOverview, ...result.data };
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
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('Error loading chart data:', error);
      return [];
    }
  },

  getConfirmationMetrics: async (params?: { startDate?: string; endDate?: string }): Promise<ConfirmationMetrics> => {
    try {
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
    } catch (error) {
      console.error('Error loading confirmation metrics:', error);
      return defaultConfirmationMetrics;
    }
  },

  getTopProducts: async (limit: number = 5, params?: { startDate?: string; endDate?: string }): Promise<Product[]> => {
    try {
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
    } catch (error) {
      console.error('Error loading top products:', error);
      return [];
    }
  },

  getOrderStatusDistribution: async (params?: { startDate?: string; endDate?: string }): Promise<any[]> => {
    try {
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
    } catch (error) {
      console.error('Error loading order status distribution:', error);
      return [];
    }
  },

  getCashProjection: async (lookbackDays: number = 30): Promise<any> => {
    try {
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
    } catch (error) {
      console.error('Error loading cash projection:', error);
      return null;
    }
  },

  getCashFlowTimeline: async (periodType: 'day' | 'week' = 'week'): Promise<any> => {
    try {
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
    } catch (error) {
      console.error('Error loading cash flow timeline:', error);
      return null;
    }
  },

  getLogisticsMetrics: async (params?: { startDate?: string; endDate?: string }): Promise<LogisticsMetrics | null> => {
    try {
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
    } catch (error) {
      console.error('Error loading logistics metrics:', error);
      return null;
    }
  },

  getReturnsMetrics: async (params?: { startDate?: string; endDate?: string }): Promise<ReturnsMetrics | null> => {
    try {
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
    } catch (error) {
      console.error('Error loading returns metrics:', error);
      return null;
    }
  },

  getIncidentsMetrics: async (params?: { startDate?: string; endDate?: string }): Promise<IncidentsMetrics | null> => {
    try {
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
    } catch (error) {
      console.error('Error loading incidents metrics:', error);
      return null;
    }
  },

  getShippingCosts: async (params?: { startDate?: string; endDate?: string }): Promise<ShippingCostsMetrics | null> => {
    try {
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
    } catch (error) {
      console.error('Error loading shipping costs metrics:', error);
      return null;
    }
  },
};

// Tipos para las nuevas métricas
export interface LogisticsMetrics {
  // Pedidos despachados
  totalDispatched: number;
  dispatchedValue: number;
  // Tasa de fallidos
  failedRate: number;
  totalFailed: number;
  failedOrdersValue: number;
  // Tasa de rechazo en puerta
  doorRejectionRate: number;
  doorRejections: number;
  deliveryAttempts: number;
  // Cash collection
  cashCollectionRate: number;
  expectedCash: number;
  collectedCash: number;
  pendingCashAmount: number;
  pendingCollectionOrders: number;
  // Métricas adicionales
  inTransitOrders: number;
  inTransitValue: number;
  avgDeliveryDays: number;
  avgDeliveryAttempts: number;
  costPerFailedAttempt: number;
  // Totales
  totalOrders: number;
  deliveredOrders: number;
}

export interface ReturnsMetrics {
  // Tasa de devolución
  returnRate: number;
  returnedOrders: number;
  returnedValue: number;
  deliveredOrders: number;
  // Sesiones
  totalSessions: number;
  completedSessions: number;
  inProgressSessions: number;
  // Items
  totalItemsProcessed: number;
  itemsAccepted: number;
  itemsRejected: number;
  acceptanceRate: number;
  // Razones de rechazo
  rejectionReasons: Record<string, number>;
  // Contexto
  totalOrders: number;
}

export interface IncidentsMetrics {
  // Total de incidencias
  totalIncidents: number;
  // Estados
  activeIncidents: number;
  resolvedIncidents: number;
  expiredIncidents: number;
  // Resoluciones
  deliveredAfterIncident: number;
  cancelledIncidents: number;
  customerRejectedIncidents: number;
  // Tasas
  successRate: number;
  avgRetries: number;
}

// Tipos para métricas de costos de envío
export interface ShippingCostsMetrics {
  costs: {
    // Costos de pedidos entregados (A PAGAR a couriers)
    toPayCarriers: number;
    toPayCarriersOrders: number;
    // Costos YA PAGADOS a couriers (liquidaciones pagadas)
    paidToCarriers: number;
    // Liquidaciones creadas pendientes de pago
    pendingPayment: number;
    // Costos de pedidos en tránsito (costos futuros)
    inTransit: number;
    inTransitOrders: number;
    // Costos de pedidos listos para despachar
    readyToShip: number;
    readyToShipOrders: number;
    // Total comprometido (entregados + en tránsito)
    totalCommitted: number;
    // Total general (entregados + en tránsito + listos)
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

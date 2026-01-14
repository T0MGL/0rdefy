// ================================================================
// SETTLEMENTS SERVICE
// ================================================================
// Handles dispatch sessions, reconciliation, and daily settlements
// Flujo: Despacho → Conciliación → Liquidación → Pago
// ================================================================

import { DailySettlement } from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';

// ================================================================
// TYPES
// ================================================================

export type DispatchStatus = 'open' | 'dispatched' | 'reconciled' | 'settled';
export type DeliveryResult = 'pending' | 'delivered' | 'failed' | 'rejected' | 'rescheduled';

export interface DispatchSession {
  id: string;
  store_id: string;
  session_code: string;
  carrier_id: string;
  carrier_name?: string;
  dispatch_date: string;
  status: DispatchStatus;
  total_orders: number;
  delivered_count: number;
  failed_count: number;
  rejected_count: number;
  pending_count: number;
  total_cod_expected: number;
  total_cod_collected: number;
  total_shipping_cost: number;
  net_receivable: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  dispatched_at?: string;
  reconciled_at?: string;
  settled_at?: string;
}

export interface DispatchSessionOrder {
  id: string;
  dispatch_session_id: string;
  order_id: string;
  delivery_result: DeliveryResult;
  cod_amount: number;
  collected_amount: number;
  shipping_cost: number;
  zone_name?: string;
  failure_reason?: string;
  notes?: string;
  // Order details (joined)
  order_number?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_city?: string;
  payment_method?: string;
  products?: string;
}

export interface CreateDispatchInput {
  carrier_id: string;
  dispatch_date: string;
  order_ids: string[];
  notes?: string;
}

export interface ImportResultRow {
  order_id: string;
  delivery_result: DeliveryResult;
  collected_amount?: number;
  failure_reason?: string;
  notes?: string;
}

export interface ReconciliationSummary {
  session_id: string;
  session_code: string;
  carrier_name: string;
  total_orders: number;
  delivered: number;
  failed: number;
  rejected: number;
  pending: number;
  total_cod_expected: number;
  total_cod_collected: number;
  total_shipping_cost: number;
  net_receivable: number;
  discrepancies: Array<{
    order_id: string;
    order_number: string;
    issue: string;
    expected: number;
    actual: number;
  }>;
}

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
// DISPATCH SESSIONS - DESPACHO
// ================================================================

export const getDispatchSessions = async (params?: {
  status?: DispatchStatus;
  carrier_id?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: DispatchSession[]; pagination: any }> => {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.carrier_id) queryParams.append('carrier_id', params.carrier_id);
  if (params?.start_date) queryParams.append('start_date', params.start_date);
  if (params?.end_date) queryParams.append('end_date', params.end_date);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());

  const response = await fetch(
    `${API_BASE}/api/settlements/dispatch-sessions?${queryParams.toString()}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch dispatch sessions');
  }

  return response.json();
};

export const getDispatchSessionById = async (id: string): Promise<{
  session: DispatchSession;
  orders: DispatchSessionOrder[];
}> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/dispatch-sessions/${id}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch dispatch session');
  }

  return response.json();
};

export const createDispatchSession = async (
  data: CreateDispatchInput
): Promise<DispatchSession> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/dispatch-sessions`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create dispatch session');
  }

  const result = await response.json();
  return result.data;
};

export const markSessionDispatched = async (id: string): Promise<DispatchSession> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/dispatch-sessions/${id}/dispatch`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to mark session as dispatched');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// EXPORT - PARA EL COURIER (Excel o CSV)
// ================================================================

export const exportDispatchFile = async (
  sessionId: string,
  format: 'xlsx' | 'csv' = 'xlsx'
): Promise<Blob> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/dispatch-sessions/${sessionId}/export?format=${format}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to export file');
  }

  return response.blob();
};

// Legacy function for backwards compatibility
export const exportDispatchCSV = async (sessionId: string): Promise<Blob> => {
  return exportDispatchFile(sessionId, 'csv');
};

export const downloadDispatchFile = async (
  sessionId: string,
  sessionCode: string,
  format: 'xlsx' | 'csv' = 'xlsx'
): Promise<void> => {
  const blob = await exportDispatchFile(sessionId, format);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sessionCode}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

// Legacy function for backwards compatibility
export const downloadDispatchCSV = async (sessionId: string, sessionCode: string): Promise<void> => {
  return downloadDispatchFile(sessionId, sessionCode, 'xlsx'); // Default to Excel now
};

// ================================================================
// CSV IMPORT & CONCILIACIÓN
// ================================================================

export const importDeliveryResults = async (
  sessionId: string,
  results: ImportResultRow[]
): Promise<ReconciliationSummary> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/dispatch-sessions/${sessionId}/import`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ results }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to import delivery results');
  }

  return response.json();
};

export const parseDeliveryResultsCSV = (csvContent: string): ImportResultRow[] => {
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const results: ImportResultRow[] = [];

  // Map Spanish column names to our fields
  const columnMap: Record<string, string> = {
    'nroreferencia': 'order_id',
    'order_id': 'order_id',
    'id_pedido': 'order_id',
    'estado_entrega': 'delivery_result',
    'resultado': 'delivery_result',
    'delivery_result': 'delivery_result',
    'monto_cobrado': 'collected_amount',
    'collected_amount': 'collected_amount',
    'importe_cobrado': 'collected_amount',
    'motivo_no_entrega': 'failure_reason',
    'failure_reason': 'failure_reason',
    'motivo': 'failure_reason',
    'notas': 'notes',
    'notes': 'notes',
    'observaciones': 'notes',
  };

  // Map Spanish delivery results to our enum
  const resultMap: Record<string, DeliveryResult> = {
    'entregado': 'delivered',
    'delivered': 'delivered',
    'no entregado': 'failed',
    'failed': 'failed',
    'fallido': 'failed',
    'rechazado': 'rejected',
    'rejected': 'rejected',
    'reprogramado': 'rescheduled',
    'rescheduled': 'rescheduled',
    'pendiente': 'pending',
    'pending': 'pending',
  };

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row: any = {};

    headers.forEach((header, index) => {
      const mappedField = columnMap[header];
      if (mappedField && values[index]) {
        row[mappedField] = values[index];
      }
    });

    if (row.order_id) {
      // Convert delivery result
      if (row.delivery_result) {
        const normalizedResult = row.delivery_result.toLowerCase();
        row.delivery_result = resultMap[normalizedResult] || 'pending';
      }

      // Parse collected amount
      if (row.collected_amount) {
        row.collected_amount = parseFloat(
          row.collected_amount.replace(/[^\d.-]/g, '')
        ) || 0;
      }

      results.push(row as ImportResultRow);
    }
  }

  return results;
};

// ================================================================
// LIQUIDACIÓN (SETTLEMENT FROM DISPATCH)
// ================================================================

export const processDispatchSettlement = async (sessionId: string): Promise<{
  settlement: DailySettlement;
  summary: ReconciliationSummary;
}> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/dispatch-sessions/${sessionId}/settle`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to process settlement');
  }

  return response.json();
};

export const markSettlementPaid = async (
  settlementId: string,
  data: { payment_method?: string; payment_reference?: string; notes?: string }
): Promise<DailySettlement> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/v2/${settlementId}/paid`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to mark settlement as paid');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// ANALYTICS
// ================================================================

export const getSettlementsSummary = async (params?: {
  start_date?: string;
  end_date?: string;
  carrier_id?: string;
}): Promise<{
  total_dispatched: number;
  total_delivered: number;
  total_failed: number;
  delivery_rate: number;
  total_cod_expected: number;
  total_cod_collected: number;
  total_shipping_cost: number;
  total_net_receivable: number;
  pending_payment: number;
  by_carrier: Array<{
    carrier_id: string;
    carrier_name: string;
    dispatched: number;
    delivered: number;
    failed: number;
    delivery_rate: number;
    total_cod: number;
    shipping_cost: number;
    net_receivable: number;
  }>;
}> => {
  const queryParams = new URLSearchParams();
  if (params?.start_date) queryParams.append('start_date', params.start_date);
  if (params?.end_date) queryParams.append('end_date', params.end_date);
  if (params?.carrier_id) queryParams.append('carrier_id', params.carrier_id);

  const response = await fetch(
    `${API_BASE}/api/settlements/summary/v2?${queryParams.toString()}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch settlements summary');
  }

  return response.json();
};

export const getPendingByCarrier = async (): Promise<Array<{
  carrier_id: string;
  carrier_name: string;
  pending_sessions: number;
  pending_amount: number;
  oldest_dispatch: string;
}>> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/pending-by-carrier`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch pending by carrier');
  }

  return response.json();
};

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-PY', {
    style: 'currency',
    currency: 'PYG',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const getStatusColor = (status: DispatchStatus): string => {
  const colors: Record<DispatchStatus, string> = {
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    dispatched: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    reconciled: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    settled: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
};

export const getDeliveryResultColor = (result: DeliveryResult): string => {
  const colors: Record<DeliveryResult, string> = {
    pending: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    rejected: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    rescheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  };
  return colors[result] || 'bg-gray-100 text-gray-800';
};

export const translateStatus = (status: DispatchStatus): string => {
  const translations: Record<DispatchStatus, string> = {
    open: 'Abierto',
    dispatched: 'Despachado',
    reconciled: 'Conciliado',
    settled: 'Liquidado',
  };
  return translations[status] || status;
};

export const translateDeliveryResult = (result: DeliveryResult): string => {
  const translations: Record<DeliveryResult, string> = {
    pending: 'Pendiente',
    delivered: 'Entregado',
    failed: 'No Entregado',
    rejected: 'Rechazado',
    rescheduled: 'Reprogramado',
  };
  return translations[result] || result;
};

// ================================================================
// EXPORT ALL
// ================================================================
export const settlementsService = {
  // Legacy settlements (v1)
  getAll: getSettlements,
  getToday: getTodaySettlement,
  getById: getSettlementById,
  create: createSettlement,
  update: updateSettlement,
  complete: completeSettlement,
  getStats: getSettlementStats,
  delete: deleteSettlement,

  // Dispatch sessions (new)
  dispatch: {
    getAll: getDispatchSessions,
    getById: getDispatchSessionById,
    create: createDispatchSession,
    markDispatched: markSessionDispatched,
    exportCSV: exportDispatchCSV,
    downloadCSV: downloadDispatchCSV,
    importResults: importDeliveryResults,
    parseCSV: parseDeliveryResultsCSV,
    settle: processDispatchSettlement,
  },

  // V2 settlements
  v2: {
    markPaid: markSettlementPaid,
    getSummary: getSettlementsSummary,
    getPendingByCarrier: getPendingByCarrier,
  },

  // Carrier accounts (unified system)
  carrierAccounts: {
    getBalances: getCarrierBalances,
    getSummary: getCarrierAccountSummary,
    getDetail: getCarrierDetail,
    getMovements: getCarrierMovements,
    getUnsettled: getCarrierUnsettled,
    updateConfig: updateCarrierConfig,
    createAdjustment: createCarrierAdjustment,
    registerPayment: registerCarrierPayment,
    getPayments: getCarrierPayments,
    backfillMovements: backfillCarrierMovements,
  },

  // Utilities
  utils: {
    formatCurrency,
    getStatusColor,
    getDeliveryResultColor,
    translateStatus,
    translateDeliveryResult,
  },
};

// ================================================================
// CARRIER ACCOUNT TYPES
// ================================================================

export interface CarrierBalance {
  carrier_id: string;
  carrier_name: string;
  settlement_type: 'net' | 'gross' | 'salary';
  charges_failed_attempts: boolean;
  payment_schedule: string;
  total_cod_collected: number;
  total_delivery_fees: number;
  total_failed_fees: number;
  total_payments_received: number;
  total_payments_sent: number;
  total_adjustments: number;
  net_balance: number;
  unsettled_balance: number;
  unsettled_orders: number;
  last_movement_date: string | null;
  last_payment_date: string | null;
}

export interface CarrierAccountSummary {
  totalCarriersWithBalance: number;
  totalOwedByCarriers: number;
  totalOwedToCarriers: number;
  netPosition: number;
  pendingSettlements: number;
}

export interface CarrierMovement {
  id: string;
  store_id: string;
  carrier_id: string;
  carrier_name?: string;
  movement_type: string;
  amount: number;
  order_id: string | null;
  order_number: string | null;
  dispatch_session_id: string | null;
  dispatch_session_code?: string;
  settlement_id: string | null;
  payment_record_id: string | null;
  description: string | null;
  metadata: Record<string, any>;
  movement_date: string;
  created_at: string;
  days_pending?: number;
}

export interface CarrierPayment {
  id: string;
  store_id: string;
  carrier_id: string;
  carrier_name?: string;
  payment_code: string;
  direction: 'from_carrier' | 'to_carrier';
  amount: number;
  period_start: string | null;
  period_end: string | null;
  payment_method: string;
  payment_reference: string | null;
  status: string;
  notes: string | null;
  payment_date: string;
  created_at: string;
}

// ================================================================
// CARRIER ACCOUNT FUNCTIONS
// ================================================================

export const getCarrierBalances = async (): Promise<CarrierBalance[]> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-accounts`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch carrier balances');
  }

  const result = await response.json();
  return result.data;
};

export const getCarrierAccountSummary = async (): Promise<CarrierAccountSummary> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-accounts/summary`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch account summary');
  }

  const result = await response.json();
  return result.data;
};

export const getCarrierDetail = async (
  carrierId: string,
  fromDate?: string,
  toDate?: string
): Promise<any> => {
  const params = new URLSearchParams();
  if (fromDate) params.append('from_date', fromDate);
  if (toDate) params.append('to_date', toDate);

  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-accounts/${carrierId}?${params.toString()}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch carrier detail');
  }

  const result = await response.json();
  return result.data;
};

export const getCarrierMovements = async (
  carrierId: string,
  options?: {
    fromDate?: string;
    toDate?: string;
    movementType?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ data: CarrierMovement[]; count: number }> => {
  const params = new URLSearchParams();
  if (options?.fromDate) params.append('from_date', options.fromDate);
  if (options?.toDate) params.append('to_date', options.toDate);
  if (options?.movementType) params.append('movement_type', options.movementType);
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.offset) params.append('offset', options.offset.toString());

  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-accounts/${carrierId}/movements?${params.toString()}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch movements');
  }

  return response.json();
};

export const getCarrierUnsettled = async (
  carrierId: string
): Promise<CarrierMovement[]> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-accounts/${carrierId}/unsettled`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch unsettled movements');
  }

  const result = await response.json();
  return result.data;
};

export const updateCarrierConfig = async (
  carrierId: string,
  config: {
    settlement_type?: 'net' | 'gross' | 'salary';
    charges_failed_attempts?: boolean;
    payment_schedule?: string;
  }
): Promise<void> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-accounts/${carrierId}/config`,
    {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(config),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update config');
  }
};

export const createCarrierAdjustment = async (
  carrierId: string,
  amount: number,
  type: 'credit' | 'debit',
  description: string
): Promise<CarrierMovement> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-accounts/${carrierId}/adjustment`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ amount, type, description }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create adjustment');
  }

  const result = await response.json();
  return result.data;
};

export const registerCarrierPayment = async (
  carrierId: string,
  amount: number,
  direction: 'from_carrier' | 'to_carrier',
  paymentMethod: string,
  options?: {
    paymentReference?: string;
    notes?: string;
    settlementIds?: string[];
    movementIds?: string[];
  }
): Promise<{ paymentId: string; paymentCode: string }> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-payments`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        carrier_id: carrierId,
        amount,
        direction,
        payment_method: paymentMethod,
        payment_reference: options?.paymentReference,
        notes: options?.notes,
        settlement_ids: options?.settlementIds,
        movement_ids: options?.movementIds,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to register payment');
  }

  const result = await response.json();
  return result.data;
};

export const getCarrierPayments = async (
  carrierId?: string,
  options?: {
    fromDate?: string;
    toDate?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ data: CarrierPayment[]; count: number }> => {
  const params = new URLSearchParams();
  if (carrierId) params.append('carrier_id', carrierId);
  if (options?.fromDate) params.append('from_date', options.fromDate);
  if (options?.toDate) params.append('to_date', options.toDate);
  if (options?.status) params.append('status', options.status);
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.offset) params.append('offset', options.offset.toString());

  const response = await fetch(
    `${API_BASE}/api/settlements/carrier-payments?${params.toString()}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch payments');
  }

  return response.json();
};

export const backfillCarrierMovements = async (): Promise<{
  ordersProcessed: number;
  movementsCreated: number;
}> => {
  const response = await fetch(
    `${API_BASE}/api/settlements/backfill-movements`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to backfill movements');
  }

  const result = await response.json();
  return result.data;
};

/**
 * Courier Portal Service (frontend)
 *
 * Wraps the /api/portal surface that powers the embedded courier portal.
 * Mirrors the shape of carrier-operators.service.ts so the portal pages
 * can rely on the same conventions:
 *
 *   - localStorage for auth token + current store id
 *   - AbortSignal support on all reads
 *   - Errors thrown as PortalApiError with `status` + `payload`
 *
 * The service does NOT cache. The portal pages can layer React Query on
 * top with their own staleTimes.
 */

import { config } from '@/config';

let API_URL = config.api.baseUrl;
API_URL = API_URL.trim().replace(/(\/api\/?)+$/i, '').replace(/\/+$/, '');

// ----------------------------------------------------------------------------
// Error type
// ----------------------------------------------------------------------------

export class PortalApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'PortalApiError';
    this.status = status;
    this.payload = payload;
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function getHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (storeId) headers['X-Store-ID'] = storeId;
  return headers;
}

function getMultipartHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  const headers: HeadersInit = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (storeId) headers['X-Store-ID'] = storeId;
  return headers;
}

async function request<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { ...getHeaders(), ...(init?.headers || {}) },
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // body is not JSON; let res.ok be the source of truth
  }

  if (!res.ok) {
    const message =
      payload?.message || payload?.error || `Error ${res.status}`;
    throw new PortalApiError(message, res.status, payload);
  }

  return payload as T;
}

async function multipartRequest<T>(
  path: string,
  formData: FormData,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: getMultipartHeaders(),
    body: formData,
    signal,
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    const message =
      payload?.message || payload?.error || `Error ${res.status}`;
    throw new PortalApiError(message, res.status, payload);
  }

  return payload as T;
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface PortalMe {
  user: {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
  };
  carrier: {
    id: string;
    name: string;
  };
  store: {
    id: string;
    name: string;
    country: string | null;
    currency: string | null;
    timezone: string | null;
  };
}

export type PortalOrderView = 'active' | 'today' | 'history';

export interface PortalOrderListParams {
  view?: PortalOrderView;
  search?: string;
  page?: number;
  page_size?: number;
}

export interface PortalDeliveryPreferences {
  not_before_date?: string | null;
  preferred_time_slot?: 'morning' | 'afternoon' | 'evening' | 'any' | null;
  delivery_notes?: string | null;
}

export interface PortalOrder {
  id: string;
  display_order_number: string;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  total_price: number;
  shipping_cost: number;
  payment_method: string | null;
  is_cod: boolean;
  sleeves_status: string;
  delivery_status: string | null;
  delivery_preferences: PortalDeliveryPreferences | null;
  delivered_at: string | null;
  days_in_transit: number;
}

export interface PortalOrdersResponse {
  orders: PortalOrder[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  };
}

export interface MarkDeliveredInput {
  amount_collected?: number;
  payment_method?: string;
  photo_url?: string;
  notes?: string;
}

export interface MarkDeliveredResult {
  success?: boolean;
  already_delivered?: boolean;
  order: {
    id: string;
    sleeves_status: string;
    delivered_at?: string | null;
    amount_collected?: number;
    has_amount_discrepancy?: boolean;
    is_cod?: boolean;
  };
}

export type FailedReason =
  | 'customer_absent'
  | 'wrong_address'
  | 'customer_rejected'
  | 'other';

export interface MarkFailedInput {
  reason: FailedReason;
  notes?: string;
}

export interface MarkFailedResult {
  success?: boolean;
  already_logged?: boolean;
  attempt_id: string;
  attempt_number?: number;
  reason?: FailedReason;
}

export interface MarkReturnedInput {
  reason: string;
  notes?: string;
}

export interface MarkReturnedResult {
  success?: boolean;
  already_returned?: boolean;
  order: { id: string; sleeves_status: string };
}

export interface ReportIncidentInput {
  description: string;
}

export interface ReportIncidentResult {
  success: true;
  order: { id: string; sleeves_status: string };
}

export interface UploadProofResult {
  photo_url: string;
  path: string | null;
}

export interface PortalFinancialSummary {
  in_transit: {
    orders_count: number;
    cod_pending_to_collect: number;
    shipping_fees_pending: number;
  };
  delivered_unsettled: {
    orders_count: number;
    cod_collected_to_remit: number;
    shipping_fees_to_receive: number;
    failed_attempt_fees: number;
  };
  net_balance: number;
}

// ----------------------------------------------------------------------------
// API
// ----------------------------------------------------------------------------

export const portalService = {
  /** Profile + carrier + store header data. */
  async getMe(opts?: { signal?: AbortSignal }): Promise<PortalMe> {
    return request<PortalMe>('/portal/me', {
      method: 'GET',
      signal: opts?.signal,
    });
  },

  /**
   * List orders for the courier's view. The server bounds page_size at
   * 100 and clamps `page` to a safe range.
   */
  async getOrders(
    params: PortalOrderListParams = {},
    opts?: { signal?: AbortSignal },
  ): Promise<PortalOrdersResponse> {
    const qs = new URLSearchParams();
    if (params.view) qs.set('view', params.view);
    if (params.search) qs.set('search', params.search);
    if (params.page) qs.set('page', String(params.page));
    if (params.page_size) qs.set('page_size', String(params.page_size));
    const path = `/portal/orders${qs.toString() ? `?${qs.toString()}` : ''}`;
    return request<PortalOrdersResponse>(path, {
      method: 'GET',
      signal: opts?.signal,
    });
  },

  /**
   * Mark an order as delivered. Idempotent: a second call on a delivered
   * order returns `already_delivered: true` without side effects.
   */
  async markDelivered(
    orderId: string,
    body: MarkDeliveredInput,
  ): Promise<MarkDeliveredResult> {
    return request<MarkDeliveredResult>(
      `/portal/orders/${encodeURIComponent(orderId)}/mark-delivered`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    );
  },

  /**
   * Log a failed delivery attempt. Does not change the order status.
   * Dedupes against the same (user, reason) pair within 5 minutes.
   */
  async markFailed(
    orderId: string,
    body: MarkFailedInput,
  ): Promise<MarkFailedResult> {
    return request<MarkFailedResult>(
      `/portal/orders/${encodeURIComponent(orderId)}/mark-failed`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  /** Mark an order as returned. Idempotent on already-returned. */
  async markReturned(
    orderId: string,
    body: MarkReturnedInput,
  ): Promise<MarkReturnedResult> {
    return request<MarkReturnedResult>(
      `/portal/orders/${encodeURIComponent(orderId)}/mark-returned`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  /** Report an active incident. Parks the order at sleeves_status='incident'. */
  async reportIncident(
    orderId: string,
    body: ReportIncidentInput,
  ): Promise<ReportIncidentResult> {
    return request<ReportIncidentResult>(
      `/portal/orders/${encodeURIComponent(orderId)}/report-incident`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  /**
   * Upload a proof-of-delivery photo. Returns a public URL the caller
   * passes back to markDelivered as `photo_url`.
   */
  async uploadProof(
    orderId: string,
    file: File,
    opts?: { signal?: AbortSignal },
  ): Promise<UploadProofResult> {
    const formData = new FormData();
    formData.append('file', file);
    return multipartRequest<UploadProofResult>(
      `/portal/orders/${encodeURIComponent(orderId)}/upload-proof`,
      formData,
      opts?.signal,
    );
  },

  /** Real-time financial dashboard for the courier. Cacheable for 30s. */
  async getFinancialSummary(
    opts?: { signal?: AbortSignal },
  ): Promise<PortalFinancialSummary> {
    return request<PortalFinancialSummary>('/portal/financial-summary', {
      method: 'GET',
      signal: opts?.signal,
    });
  },
};

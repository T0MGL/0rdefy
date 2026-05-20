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
  /**
   * Backend error code (e.g. `PROOF_UPLOAD_FAILED`, `COURIER_REASSIGNED`).
   * Extracted from `payload.code` on construction so call sites can branch
   * on it without re-typing the payload every time. Pass an explicit string
   * as the `payload` argument and it becomes the code; pass an object and
   * we read `payload.code` if present.
   */
  code: string | null;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'PortalApiError';
    this.status = status;
    this.payload = payload;
    if (typeof payload === 'string') {
      this.code = payload;
    } else if (
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { code?: unknown }).code === 'string'
    ) {
      this.code = (payload as { code: string }).code;
    } else {
      this.code = null;
    }
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
  /** Set when the order was paid up-front (transferencia, QR, online). Null
   *  for COD orders. Used to distinguish "Prepago · transferencia" from a
   *  generic "Prepago" label and to render the right UI in the inline confirm. */
  prepaid_method: string | null;
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
// Settlements (Migration 194 + Phase 3 of portal)
// ----------------------------------------------------------------------------

export interface PortalPendingSettlementOrder {
  id: string;
  display_order_number: string;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  total_price: number;
  cod_amount: number;
  payment_method: string | null;
  prepaid_method: string | null;
  is_cod: boolean;
  delivered_at: string | null;
}

export interface PortalPendingSettlementsResult {
  summary: {
    total_orders: number;
    total_cod_to_remit: number;
    total_prepaid_count: number;
    oldest_delivery_date: string | null;
    newest_delivery_date: string | null;
    days_oldest: number;
    failed_attempt_fee_percent: number;
  };
  orders: PortalPendingSettlementOrder[];
}

export interface PortalSettlementProof {
  id: string;
  signed_url: string;
  mime_type: string;
  file_size_bytes: number;
  amount_claimed: number;
  payment_reference: string | null;
  payment_method: string | null;
  uploaded_at: string;
}

export interface PortalSettlement {
  id: string;
  settlement_code: string;
  settlement_date: string | null;
  min_delivery_date: string | null;
  max_delivery_date: string | null;
  total_orders: number;
  total_delivered: number;
  total_not_delivered: number;
  total_cod_collected: number;
  total_carrier_fees: number;
  total_extra_charges: number;
  failed_attempt_fee: number;
  net_receivable: number;
  amount_paid: number;
  status: string;
  payment_method: string | null;
  payment_reference: string | null;
  submitted_by_courier_at: string | null;
  created_at: string | null;
  proofs: PortalSettlementProof[];
}

export interface PortalSettlementsHistoryResult {
  settlements: PortalSettlement[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  };
}

export type SettlementPaymentMethod =
  | 'transfer'
  | 'qr'
  | 'cash_deposit'
  | 'other';

export interface CloseSettlementInput {
  order_ids: string[];
  total_amount_collected: number;
  payment_method: SettlementPaymentMethod;
  payment_reference: string;
  notes?: string | null;
}

export interface CloseSettlementResult {
  success: true;
  settlement_id: string;
  settlement_code: string;
  status: string;
  proof_id: string;
  net_receivable: number;
  total_orders: number;
  total_delivered: number;
  total_cod_collected: number;
  total_carrier_fees: number;
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
   * Upload a proof-of-delivery photo.
   *
   * DISABLED for production launch — the previous implementation wrote PII
   * (customer + address) into the public `merchandise` Supabase bucket. The
   * backend endpoint now returns 501. Calling this helper throws so the
   * mistake is caught at the call site instead of round-tripping a useless
   * request. Re-enable once the private delivery-proofs bucket lands.
   */
  async uploadProof(
    _orderId: string,
    _file: File,
    _opts?: { signal?: AbortSignal },
  ): Promise<UploadProofResult> {
    throw new PortalApiError(
      'Subida de comprobante temporalmente deshabilitada',
      501,
      'UPLOAD_PROOF_DISABLED',
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

  /**
   * List the courier's pending reconciliation backlog. Returns a summary
   * plus the detailed list of orders, sorted oldest first.
   */
  async getPendingSettlements(
    opts?: { signal?: AbortSignal },
  ): Promise<PortalPendingSettlementsResult> {
    return request<PortalPendingSettlementsResult>('/portal/settlements/pending', {
      method: 'GET',
      signal: opts?.signal,
    });
  },

  /**
   * List already-closed settlements for the courier, newest first.
   * Each proof includes a signed URL valid for ~5 minutes; re-fetch the
   * list when the URL expires.
   */
  async getSettlementsHistory(
    params: { page?: number; page_size?: number } = {},
    opts?: { signal?: AbortSignal },
  ): Promise<PortalSettlementsHistoryResult> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.page_size) qs.set('page_size', String(params.page_size));
    const path = `/portal/settlements/history${qs.toString() ? `?${qs.toString()}` : ''}`;
    return request<PortalSettlementsHistoryResult>(path, {
      method: 'GET',
      signal: opts?.signal,
    });
  },

  /**
   * Close a settlement on behalf of the courier. The backend creates the
   * daily_settlements row stamped status='paid' (auto-paid trust model),
   * uploads the bank-transfer screenshot to private Storage, and inserts
   * the proof metadata. Multipart request.
   */
  async closeSettlement(
    payload: CloseSettlementInput,
    file: File,
    opts?: { signal?: AbortSignal },
  ): Promise<CloseSettlementResult> {
    const formData = new FormData();
    formData.append('order_ids', JSON.stringify(payload.order_ids));
    formData.append('total_amount_collected', String(payload.total_amount_collected));
    formData.append('payment_method', payload.payment_method);
    formData.append('payment_reference', payload.payment_reference);
    if (payload.notes) formData.append('notes', payload.notes);
    formData.append('file', file);
    return multipartRequest<CloseSettlementResult>(
      '/portal/settlements/close',
      formData,
      opts?.signal,
    );
  },
};

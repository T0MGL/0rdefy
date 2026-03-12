// ================================================================
// OUTBOUND WEBHOOK SERVICE
// ================================================================
// Handles outbound webhook configuration API calls.
// Allows sending notifications to external systems (n8n, Zapier, etc.)
// when order events occur (e.g., order.delivered).
// ================================================================

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
while (cleanBaseURL.endsWith('/api')) {
  cleanBaseURL = cleanBaseURL.slice(0, -4);
  cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
}
const API_BASE = cleanBaseURL;

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};

// ================================================================
// TYPES
// ================================================================

export interface OutboundWebhookConfig {
  id: string;
  store_id: string;
  name: string;
  url: string;
  signing_secret_prefix: string;
  events: string[];
  is_active: boolean;
  custom_headers: Record<string, string>;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
  total_deliveries: number;
  total_failures: number;
}

export interface OutboundWebhookDelivery {
  id: string;
  config_id: string;
  event: string;
  payload: any;
  status: 'pending' | 'success' | 'failed';
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface WebhookEvent {
  event: string;
  description: string;
}

export interface CreateOutboundWebhookParams {
  name: string;
  url: string;
  events: string[];
  custom_headers?: Record<string, string>;
}

export interface UpdateOutboundWebhookParams {
  name?: string;
  url?: string;
  events?: string[];
  is_active?: boolean;
  custom_headers?: Record<string, string>;
}

// ================================================================
// HELPERS
// ================================================================

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = (body as any)?.error || `HTTP ${res.status}`;
    return { success: false, error } as T;
  }
  return await res.json();
}

// ================================================================
// API FUNCTIONS
// ================================================================

async function getConfigs(
  signal?: AbortSignal
): Promise<{ success: boolean; configs: OutboundWebhookConfig[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/outbound-webhooks/configs`, {
      headers: getAuthHeaders(),
      signal,
    });
    return await parseResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return { success: false, configs: [], error: 'Error de conexión' };
  }
}

async function createConfig(
  params: CreateOutboundWebhookParams,
  signal?: AbortSignal
): Promise<{ success: boolean; config?: OutboundWebhookConfig; signing_secret?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/outbound-webhooks/configs`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
      signal,
    });
    return await parseResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return { success: false, error: 'Error de conexión' };
  }
}

async function updateConfig(
  configId: string,
  params: UpdateOutboundWebhookParams,
  signal?: AbortSignal
): Promise<{ success: boolean; config?: OutboundWebhookConfig; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/outbound-webhooks/configs/${configId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
      signal,
    });
    return await parseResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return { success: false, error: 'Error de conexión' };
  }
}

async function deleteConfig(
  configId: string,
  signal?: AbortSignal
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/outbound-webhooks/configs/${configId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      signal,
    });
    return await parseResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return { success: false, error: 'Error de conexión' };
  }
}

async function testWebhook(
  configId: string,
  signal?: AbortSignal
): Promise<{ success: boolean; result?: any; message?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/outbound-webhooks/configs/${configId}/test`, {
      method: 'POST',
      headers: getAuthHeaders(),
      signal,
    });
    return await parseResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return { success: false, error: 'Error de conexión' };
  }
}

async function regenerateSecret(
  configId: string,
  signal?: AbortSignal
): Promise<{ success: boolean; signing_secret?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/outbound-webhooks/configs/${configId}/regenerate-secret`, {
      method: 'POST',
      headers: getAuthHeaders(),
      signal,
    });
    return await parseResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return { success: false, error: 'Error de conexión' };
  }
}

async function getDeliveries(
  configId?: string,
  limit = 50,
  offset = 0,
  signal?: AbortSignal
): Promise<{ success: boolean; deliveries: OutboundWebhookDelivery[]; total: number; error?: string }> {
  try {
    const params = new URLSearchParams();
    if (configId) params.set('config_id', configId);
    params.set('limit', String(limit));
    params.set('offset', String(Math.max(0, offset)));

    const res = await fetch(`${API_BASE}/api/outbound-webhooks/deliveries?${params}`, {
      headers: getAuthHeaders(),
      signal,
    });
    return await parseResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return { success: false, deliveries: [], total: 0, error: 'Error de conexión' };
  }
}

async function getEvents(
  signal?: AbortSignal
): Promise<{ success: boolean; events: WebhookEvent[]; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/outbound-webhooks/events`, {
      headers: getAuthHeaders(),
      signal,
    });
    return await parseResponse(res);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return { success: false, events: [], error: 'Error de conexión' };
  }
}

// ================================================================
// EXPORT
// ================================================================

export const outboundWebhookService = {
  getConfigs,
  createConfig,
  updateConfig,
  deleteConfig,
  testWebhook,
  regenerateSecret,
  getDeliveries,
  getEvents,
};

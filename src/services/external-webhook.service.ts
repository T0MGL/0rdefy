// ================================================================
// EXTERNAL WEBHOOK SERVICE
// ================================================================
// Handles External Webhook integration API calls
// Allows receiving orders from landing pages and external systems
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
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};

// ================================================================
// TYPES
// ================================================================

export interface ExternalWebhookConfig {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  api_key_prefix: string;
  is_active: boolean;
  auto_confirm_orders: boolean;
  default_currency: string;
  total_orders_received: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  webhook_url: string;
}

export interface WebhookLog {
  id: string;
  config_id: string;
  store_id: string;
  request_id: string | null;
  source_ip: string | null;
  user_agent: string | null;
  payload: any;
  headers: any;
  status: 'pending' | 'success' | 'failed' | 'duplicate' | 'validation_error';
  order_id: string | null;
  customer_id: string | null;
  error_message: string | null;
  error_details: any;
  processing_time_ms: number | null;
  created_at: string;
}

export interface SetupResponse {
  success: boolean;
  message: string;
  webhook_url: string;
  api_key: string;
  config: {
    id: string;
    name: string;
    is_active: boolean;
    auto_confirm_orders: boolean;
  };
}

export interface PaginatedLogs {
  logs: WebhookLog[];
  total: number;
  page: number;
  totalPages: number;
}

export interface PayloadExample {
  example: any;
  documentation: {
    required_fields: Record<string, string>;
    optional_fields: Record<string, string>;
    headers: Record<string, string>;
  };
}

// ================================================================
// API FUNCTIONS
// ================================================================

/**
 * Obtener la configuración del webhook externo
 */
export const getExternalWebhookConfig = async (): Promise<{
  success: boolean;
  config?: ExternalWebhookConfig;
  error?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/external-webhooks/config`,
      {
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to get webhook configuration');
    }

    const data = await response.json();

    // Backend now returns 200 with success: false when not configured
    if (!data.success) {
      return { success: false, error: data.error || 'not_configured' };
    }

    return data;
  } catch (error: any) {
    console.error('[EXTERNAL-WEBHOOK] Error getting config:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Configurar el webhook externo
 */
export const setupExternalWebhook = async (options?: {
  name?: string;
  description?: string;
  autoConfirm?: boolean;
}): Promise<SetupResponse | { success: false; error: string }> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/external-webhooks/setup`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(options || {}),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || data.message || 'Failed to setup webhook' };
    }

    return data;
  } catch (error: any) {
    console.error('[EXTERNAL-WEBHOOK] Error setting up webhook:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Regenerar el API Key
 */
export const regenerateApiKey = async (): Promise<{
  success: boolean;
  api_key?: string;
  error?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/external-webhooks/regenerate-key`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to regenerate API key' };
    }

    return data;
  } catch (error: any) {
    console.error('[EXTERNAL-WEBHOOK] Error regenerating key:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Desactivar o eliminar el webhook
 */
export const disableExternalWebhook = async (permanent: boolean = false): Promise<{
  success: boolean;
  error?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/external-webhooks/config?permanent=${permanent}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to disable webhook' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[EXTERNAL-WEBHOOK] Error disabling webhook:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Obtener los logs del webhook
 */
export const getWebhookLogs = async (page: number = 1, limit: number = 20): Promise<{
  success: boolean;
  logs?: WebhookLog[];
  total?: number;
  page?: number;
  totalPages?: number;
  error?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/external-webhooks/logs?page=${page}&limit=${limit}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to get logs' };
    }

    return data;
  } catch (error: any) {
    console.error('[EXTERNAL-WEBHOOK] Error getting logs:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Obtener detalles de un log específico
 */
export const getLogDetails = async (logId: string): Promise<{
  success: boolean;
  log?: WebhookLog;
  error?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/external-webhooks/logs/${logId}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to get log details' };
    }

    return data;
  } catch (error: any) {
    console.error('[EXTERNAL-WEBHOOK] Error getting log details:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Obtener ejemplo del payload esperado
 */
export const getPayloadExample = async (): Promise<{
  success: boolean;
  example?: any;
  documentation?: PayloadExample['documentation'];
  error?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/external-webhooks/payload-example`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to get payload example' };
    }

    return data;
  } catch (error: any) {
    console.error('[EXTERNAL-WEBHOOK] Error getting payload example:', error);
    return { success: false, error: error.message };
  }
};

// ================================================================
// EXPORT ALL AS OBJECT
// ================================================================

export const externalWebhookService = {
  getConfig: getExternalWebhookConfig,
  setup: setupExternalWebhook,
  regenerateApiKey,
  disable: disableExternalWebhook,
  getLogs: getWebhookLogs,
  getLogDetails,
  getPayloadExample,
};

export default externalWebhookService;

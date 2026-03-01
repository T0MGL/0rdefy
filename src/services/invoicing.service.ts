/**
 * Invoicing Service - Frontend API client
 *
 * Handles all communication with the invoicing API endpoints.
 */

import { logger } from '@/utils/logger';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.trim();
cleanBaseURL = cleanBaseURL.replace(/(\/api\/?)+$/i, '');
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
const API_BASE_URL = `${cleanBaseURL}/api/invoicing`;

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};

const getAuthHeadersNoContentType = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  return {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};

// ================================================================
// Types
// ================================================================

export interface FiscalConfig {
  id: string;
  store_id: string;
  ruc: string;
  ruc_dv: number;
  razon_social: string;
  nombre_fantasia?: string;
  tipo_contribuyente: number;
  tipo_regimen?: number;
  timbrado: string;
  timbrado_fecha_inicio?: string;
  timbrado_fecha_fin?: string;
  establecimiento_codigo: string;
  punto_expedicion: string;
  establecimiento_direccion?: string;
  establecimiento_departamento?: number;
  establecimiento_distrito?: number;
  establecimiento_ciudad?: number;
  establecimiento_telefono?: string;
  establecimiento_email?: string;
  actividad_economica_codigo?: string;
  actividad_economica_descripcion?: string;
  sifen_environment: 'demo' | 'test' | 'prod';
  is_active: boolean;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  store_id: string;
  order_id?: string;
  cdc?: string;
  document_number: number;
  tipo_documento: number;
  customer_ruc?: string;
  customer_ruc_dv?: number;
  customer_name?: string;
  customer_email?: string;
  customer_address?: string;
  subtotal: number;
  iva_5: number;
  iva_10: number;
  iva_exento: number;
  total: number;
  currency: string;
  sifen_status: 'pending' | 'sent' | 'approved' | 'rejected' | 'cancelled' | 'demo';
  sifen_response_code?: string;
  sifen_response_message?: string;
  kude_url?: string;
  created_at: string;
  updated_at: string;
  events?: InvoiceEvent[];
}

export interface InvoiceEvent {
  id: string;
  invoice_id: string;
  event_type: string;
  details?: Record<string, any>;
  created_by?: string;
  created_at: string;
}

export interface InvoiceStats {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  demo: number;
  cancelled: number;
  total_facturado: number;
}

// ================================================================
// API Methods
// ================================================================

export const invoicingService = {
  // -- Fiscal Config --

  async getConfig(): Promise<{ data: FiscalConfig | null; setup_required?: boolean }> {
    const res = await fetch(`${API_BASE_URL}/config`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al obtener configuración fiscal');
    }
    return res.json();
  },

  async saveConfig(config: Partial<FiscalConfig>): Promise<FiscalConfig> {
    const res = await fetch(`${API_BASE_URL}/config`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al guardar configuración fiscal');
    }
    const json = await res.json();
    return json.data;
  },

  async uploadCertificate(file: File, password: string): Promise<any> {
    const formData = new FormData();
    formData.append('certificate', file);
    formData.append('password', password);

    const res = await fetch(`${API_BASE_URL}/config/certificate`, {
      method: 'POST',
      headers: getAuthHeadersNoContentType(),
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al cargar certificado');
    }
    return res.json();
  },

  async validateConfig(): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const res = await fetch(`${API_BASE_URL}/config/validate`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error de validación');
    }
    const json = await res.json();
    return json.data;
  },

  // -- Invoices --

  async generateInvoice(orderId: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/generate/${orderId}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al generar factura');
    }
    return res.json();
  },

  async getInvoices(filters?: {
    status?: string;
    tipo_documento?: number;
    from_date?: string;
    to_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ invoices: Invoice[]; total: number }> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.tipo_documento) params.set('tipo_documento', String(filters.tipo_documento));
    if (filters?.from_date) params.set('from_date', filters.from_date);
    if (filters?.to_date) params.set('to_date', filters.to_date);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));

    const url = `${API_BASE_URL}/invoices${params.toString() ? `?${params}` : ''}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al obtener facturas');
    }
    return res.json();
  },

  async getInvoice(invoiceId: string): Promise<Invoice> {
    const res = await fetch(`${API_BASE_URL}/invoices/${invoiceId}`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Factura no encontrada');
    }
    const json = await res.json();
    return json.data;
  },

  async downloadXML(invoiceId: string): Promise<Blob> {
    const res = await fetch(`${API_BASE_URL}/invoices/${invoiceId}/xml`, {
      headers: getAuthHeadersNoContentType(),
    });
    if (!res.ok) throw new Error('Error al descargar XML');
    return res.blob();
  },

  async cancelInvoice(invoiceId: string, motivo: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/invoices/${invoiceId}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ motivo }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al cancelar factura');
    }
    return res.json();
  },

  async retryInvoice(invoiceId: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/invoices/${invoiceId}/retry`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al reintentar envío');
    }
    return res.json();
  },

  // -- Stats --

  async getStats(): Promise<InvoiceStats> {
    const res = await fetch(`${API_BASE_URL}/stats`, { headers: getAuthHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al obtener estadísticas');
    }
    const json = await res.json();
    return json.data;
  },
};

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
const API_FISCAL_URL = `${cleanBaseURL}/api/fiscal`;

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

/**
 * Aggregate readiness returned alongside the config. Tells the UI exactly
 * which block(s) are missing so it can show targeted messaging instead of
 * a generic "setup required".
 */
export interface FiscalReadiness {
  ready: boolean;
  missing: Array<
    'identity' | 'representante_legal' | 'actividad_principal' | 'certificado' | 'setup_completed'
  >;
  has_identity: boolean;
  has_link: boolean;
  has_representante_legal: boolean;
  has_principal_activity: boolean;
  has_certificate: boolean;
  cert_required: boolean;
  setup_completed: boolean;
  sifen_environment: 'demo' | 'test' | 'prod';
}

export interface ManualInvoiceItem {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  ivaRate: 10 | 5 | 0;
}

export interface ManualInvoiceInput {
  tipoDocumento: 1 | 5 | 6;
  customerName: string;
  customerRuc?: string;
  customerRucDv?: number;
  customerEmail?: string;
  items: ManualInvoiceItem[];
  /**
   * Optional economic-activity code. Required when the fiscal identity has
   * more than one registered activity so the emitter specifies which one
   * applies to this invoice. When omitted, the identity's principal
   * activity is used.
   */
  activityCode?: string;
}

export interface ManualInvoiceResult {
  invoice_id: string;
  cdc?: string;
  document_number: number;
  status: string;
  kude_url?: string | null;
}

// ================================================================
// API Methods
// ================================================================

export const invoicingService = {
  // -- Fiscal Config --

  async getConfig(): Promise<{
    data: FiscalConfig | null;
    setup_required?: boolean;
    readiness?: FiscalReadiness;
  }> {
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

  async generateManualInvoice(input: ManualInvoiceInput): Promise<{ data: ManualInvoiceResult; message: string }> {
    const res = await fetch(`${API_BASE_URL}/generate/manual`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al emitir factura');
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

  async downloadKude(invoiceId: string): Promise<Blob> {
    const res = await fetch(`${API_BASE_URL}/invoices/${invoiceId}/kude`, {
      headers: getAuthHeadersNoContentType(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al descargar PDF de la factura');
    }
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

// ================================================================
// Fiscal identities / activities / store link (/api/fiscal/*)
//
// This API surfaces the new 3-table model (fiscal_identities,
// fiscal_identity_activities, fiscal_identity_stores). The legacy
// /api/invoicing/config endpoints stay available while the wizard is
// migrated.
// ================================================================

export interface FiscalActivity {
  id: string;
  codigo: string;
  descripcion: string;
  is_principal: boolean;
  display_order: number;
}

export interface FiscalIdentity {
  id: string;
  owner_user_id: string;
  ruc: string;
  ruc_dv: number;
  razon_social: string;
  nombre_fantasia: string | null;
  tipo_contribuyente: 1 | 2;
  tipo_regimen: number | null;
  country: 'PY';
  sifen_environment: 'demo' | 'test' | 'prod';
  has_certificate: boolean;
  csc_id: string | null;
  representante_legal_nombre: string | null;
  representante_legal_documento_tipo: 1 | 2 | 3 | 4 | 5 | 6 | 9 | null;
  representante_legal_documento_numero: string | null;
  representante_legal_cargo: string | null;
  domicilio_fiscal_direccion: string | null;
  domicilio_fiscal_numero_casa: string | null;
  domicilio_fiscal_departamento: number | null;
  domicilio_fiscal_distrito: number | null;
  domicilio_fiscal_ciudad: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  activities: FiscalActivity[];
}

export interface FiscalStoreLink {
  id: string;
  store_id: string;
  timbrado: string;
  timbrado_fecha_inicio: string | null;
  timbrado_fecha_fin: string | null;
  establecimiento_codigo: string;
  punto_expedicion: string;
  establecimiento_direccion: string | null;
  establecimiento_departamento: number | null;
  establecimiento_distrito: number | null;
  establecimiento_ciudad: number | null;
  establecimiento_telefono: string | null;
  establecimiento_email: string | null;
  next_document_number: number;
  is_active: boolean;
  setup_completed: boolean;
}

export interface FiscalContext {
  identity: Omit<FiscalIdentity, 'activities'>;
  link: FiscalStoreLink;
  activities: FiscalActivity[];
}

export interface FiscalIdentityInput {
  ruc: string;
  ruc_dv: number;
  razon_social: string;
  nombre_fantasia?: string | null;
  tipo_contribuyente: 1 | 2;
  tipo_regimen?: number | null;
  sifen_environment?: 'demo' | 'test' | 'prod';
  representante_legal_nombre?: string | null;
  representante_legal_documento_tipo?: 1 | 2 | 3 | 4 | 5 | 6 | 9 | null;
  representante_legal_documento_numero?: string | null;
  representante_legal_cargo?: string | null;
  domicilio_fiscal_direccion?: string | null;
  domicilio_fiscal_numero_casa?: string | null;
  domicilio_fiscal_departamento?: number | null;
  domicilio_fiscal_distrito?: number | null;
  domicilio_fiscal_ciudad?: number | null;
}

export interface FiscalActivityInput {
  codigo: string;
  descripcion: string;
  is_principal?: boolean;
  display_order?: number;
}

export interface FiscalStoreLinkInput {
  timbrado: string;
  timbrado_fecha_inicio?: string | null;
  timbrado_fecha_fin?: string | null;
  establecimiento_codigo?: string;
  punto_expedicion?: string;
  establecimiento_direccion?: string | null;
  establecimiento_departamento?: number | null;
  establecimiento_distrito?: number | null;
  establecimiento_ciudad?: number | null;
  establecimiento_telefono?: string | null;
  establecimiento_email?: string | null;
}

async function fiscalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_FISCAL_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...getAuthHeaders() },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      err.code === 'INVOICING_COUNTRY_UNSUPPORTED'
        ? 'Facturacion electronica no disponible para este pais'
        : err.error || `HTTP ${res.status}`;
    const e = new Error(message);
    (e as any).code = err.code;
    (e as any).status = res.status;
    throw e;
  }
  return res.json();
}

export const fiscalService = {
  async getContext(): Promise<FiscalContext | null> {
    const json = await fiscalFetch<{ data: FiscalContext | null }>('/context');
    return json.data;
  },

  async listIdentities(): Promise<FiscalIdentity[]> {
    const json = await fiscalFetch<{ data: FiscalIdentity[] }>('/identities');
    return json.data;
  },

  async createIdentity(input: FiscalIdentityInput): Promise<FiscalIdentity> {
    const json = await fiscalFetch<{ data: FiscalIdentity }>('/identities', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return json.data;
  },

  async updateIdentity(id: string, input: Partial<FiscalIdentityInput>): Promise<FiscalIdentity> {
    const json = await fiscalFetch<{ data: FiscalIdentity }>(`/identities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return json.data;
  },

  async uploadIdentityCertificate(
    id: string,
    file: File,
    password: string,
  ): Promise<{ identity_id: string; has_certificate: true }> {
    const formData = new FormData();
    formData.append('certificate', file);
    formData.append('password', password);

    const res = await fetch(`${API_FISCAL_URL}/identities/${id}/certificate`, {
      method: 'POST',
      headers: getAuthHeadersNoContentType(),
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al cargar certificado');
    }
    const json = await res.json();
    return json.data;
  },

  async addActivity(identityId: string, input: FiscalActivityInput): Promise<FiscalActivity> {
    const json = await fiscalFetch<{ data: FiscalActivity }>(`/identities/${identityId}/activities`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return json.data;
  },

  async updateActivity(
    identityId: string,
    activityId: string,
    input: Partial<FiscalActivityInput>,
  ): Promise<FiscalActivity> {
    const json = await fiscalFetch<{ data: FiscalActivity }>(
      `/identities/${identityId}/activities/${activityId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
    return json.data;
  },

  async deleteActivity(identityId: string, activityId: string): Promise<void> {
    await fiscalFetch(`/identities/${identityId}/activities/${activityId}`, { method: 'DELETE' });
  },

  async linkIdentityToStore(
    storeId: string,
    identityId: string,
    link: FiscalStoreLinkInput,
  ): Promise<FiscalStoreLink> {
    const json = await fiscalFetch<{ data: FiscalStoreLink }>(`/stores/${storeId}/link`, {
      method: 'POST',
      body: JSON.stringify({ identity_id: identityId, link }),
    });
    return json.data;
  },

  async updateStoreFields(
    storeId: string,
    input: Partial<FiscalStoreLinkInput>,
  ): Promise<FiscalStoreLink> {
    const json = await fiscalFetch<{ data: FiscalStoreLink }>(`/stores/${storeId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return json.data;
  },
};

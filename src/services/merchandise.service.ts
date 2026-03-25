import { InboundShipment, CreateShipmentDTO, ReceiveShipmentDTO } from '@/types';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
while (cleanBaseURL.endsWith('/api')) {
  cleanBaseURL = cleanBaseURL.slice(0, -4);
  cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
}
const API_BASE_URL = `${cleanBaseURL}/api`;

interface ApiListResponse {
  data: InboundShipment[];
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface ApiErrorResponse {
  message?: string;
  error?: string;
}

interface ApiReceiveResponse {
  success: boolean;
  items_updated: number;
  status: string;
  shipment: InboundShipment;
}

interface ApiStatsResponse {
  total_shipments: number;
  pending: number;
  partial: number;
  received: number;
  total_investment: number;
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

export const merchandiseService = {
  getAll: async (filters?: {
    status?: 'pending' | 'partial' | 'received';
    supplier_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<InboundShipment[]> => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.supplier_id) params.append('supplier_id', filters.supplier_id);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());

    const url = `${API_BASE_URL}/merchandise${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await fetch(url, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const result: ApiListResponse = await response.json();
    return result.data || [];
  },

  getById: async (id: string): Promise<InboundShipment | undefined> => {
    const response = await fetch(`${API_BASE_URL}/merchandise/${id}`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) return undefined;
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const data: InboundShipment = await response.json();
    return data;
  },

  create: async (shipment: CreateShipmentDTO): Promise<InboundShipment> => {
    const response = await fetch(`${API_BASE_URL}/merchandise`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(shipment),
    });

    if (!response.ok) {
      const errorData: ApiErrorResponse = await response.json();
      throw new Error(errorData.message || errorData.error || `Error HTTP: ${response.status}`);
    }

    const data: InboundShipment = await response.json();
    return data;
  },

  update: async (id: string, data: Partial<InboundShipment>): Promise<InboundShipment | undefined> => {
    const response = await fetch(`${API_BASE_URL}/merchandise/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      if (response.status === 404) return undefined;
      const errorData: ApiErrorResponse = await response.json();
      throw new Error(errorData.message || `Error HTTP: ${response.status}`);
    }

    const result: InboundShipment = await response.json();
    return result;
  },

  delete: async (id: string): Promise<boolean> => {
    const response = await fetch(`${API_BASE_URL}/merchandise/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) return false;
      if (response.status === 400) {
        const errorData: ApiErrorResponse = await response.json();
        throw new Error(errorData.message || 'No se pueden eliminar envios recibidos');
      }
      throw new Error(`Error HTTP: ${response.status}`);
    }

    return true;
  },

  receive: async (shipmentId: string, data: ReceiveShipmentDTO): Promise<ApiReceiveResponse> => {
    const response = await fetch(`${API_BASE_URL}/merchandise/${shipmentId}/receive`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData: ApiErrorResponse = await response.json();
      throw new Error(errorData.message || errorData.error || `Error HTTP: ${response.status}`);
    }

    const result: ApiReceiveResponse = await response.json();
    return result;
  },

  getStats: async (): Promise<ApiStatsResponse> => {
    const response = await fetch(`${API_BASE_URL}/merchandise/stats/summary`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const data: ApiStatsResponse = await response.json();
    return data;
  },
};

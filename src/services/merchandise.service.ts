import { InboundShipment, CreateShipmentDTO, ReceiveShipmentDTO } from '@/types';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
while (cleanBaseURL.endsWith('/api')) {
  cleanBaseURL = cleanBaseURL.slice(0, -4);
  cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
}
const API_BASE_URL = `${cleanBaseURL}/api`;

// API response types
interface ApiListResponse {
  data: InboundShipment[];
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface ApiSingleResponse {
  data?: InboundShipment;
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

// Helper to get auth headers
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
  /**
   * Get all shipments with optional filters
   */
  getAll: async (filters?: {
    status?: 'pending' | 'partial' | 'received';
    supplier_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<InboundShipment[]> => {
    try {
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
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result: ApiListResponse = await response.json();
      return result.data || [];
    } catch (error: unknown) {
      console.error('Error loading shipments:', error);
      return [];
    }
  },

  /**
   * Get single shipment with items
   */
  getById: async (id: string): Promise<InboundShipment | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/merchandise/${id}`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) return undefined;
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: InboundShipment = await response.json();
      return data;
    } catch (error: unknown) {
      console.error('Error loading shipment:', error);
      return undefined;
    }
  },

  /**
   * Create new shipment
   */
  create: async (shipment: CreateShipmentDTO): Promise<InboundShipment> => {
    try {
      const response = await fetch(`${API_BASE_URL}/merchandise`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(shipment),
      });

      if (!response.ok) {
        const errorData: ApiErrorResponse = await response.json();
        throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data: InboundShipment = await response.json();
      return data;
    } catch (error: unknown) {
      console.error('Error creating shipment:', error);
      throw error;
    }
  },

  /**
   * Update shipment header (not items)
   */
  update: async (id: string, data: Partial<InboundShipment>): Promise<InboundShipment | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/merchandise/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        if (response.status === 404) return undefined;
        const errorData: ApiErrorResponse = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const result: InboundShipment = await response.json();
      return result;
    } catch (error: unknown) {
      console.error('Error updating shipment:', error);
      return undefined;
    }
  },

  /**
   * Delete shipment (only pending shipments can be deleted)
   */
  delete: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/merchandise/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) return false;
        if (response.status === 400) {
          const errorData: ApiErrorResponse = await response.json();
          throw new Error(errorData.message || 'Cannot delete received shipments');
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return true;
    } catch (error: unknown) {
      console.error('Error deleting shipment:', error);
      throw error;
    }
  },

  /**
   * Receive shipment - Updates inventory based on actual quantities received
   * This is the critical operation that updates product stock
   */
  receive: async (shipmentId: string, data: ReceiveShipmentDTO): Promise<ApiReceiveResponse> => {
    try {
      const response = await fetch(`${API_BASE_URL}/merchandise/${shipmentId}/receive`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData: ApiErrorResponse = await response.json();
        throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result: ApiReceiveResponse = await response.json();
      return result;
    } catch (error: unknown) {
      console.error('Error receiving shipment:', error);
      throw error;
    }
  },

  /**
   * Get statistics summary
   */
  getStats: async (): Promise<ApiStatsResponse> => {
    try {
      const response = await fetch(`${API_BASE_URL}/merchandise/stats/summary`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ApiStatsResponse = await response.json();
      return data;
    } catch (error: unknown) {
      console.error('Error loading statistics:', error);
      return {
        total_shipments: 0,
        pending: 0,
        partial: 0,
        received: 0,
        total_investment: 0,
      };
    }
  },
};

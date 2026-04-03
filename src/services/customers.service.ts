import { Customer, CustomerStatsOverview, Order } from '@/types';
import { logger } from '@/utils/logger';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.trim();
cleanBaseURL = cleanBaseURL.replace(/(\/api\/?)+$/i, '');
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
const API_BASE_URL = `${cleanBaseURL}/api`;

// API response types
interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface ApiListResponse {
  data: Customer[];
  pagination?: PaginationMeta;
}

interface ApiPaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

interface ApiSingleResponse {
  data: Customer;
}

interface ApiErrorResponse {
  message?: string;
}

export interface CustomerListParams {
  search?: string;
  sort_by?: string;
  sort_order?: string;
  limit?: number;
  offset?: number;
  min_orders?: number;
  min_spent?: number;
  city?: string;
  accepts_marketing?: boolean;
  last_order_before?: string;
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

export const customersService = {
  getAll: async (options?: CustomerListParams): Promise<Customer[]> => {
    try {
      const params = new URLSearchParams();
      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());
      if (options?.search) params.append('search', options.search);
      if (options?.sort_by) params.append('sort_by', options.sort_by);
      if (options?.sort_order) params.append('sort_order', options.sort_order);
      if (options?.min_orders !== undefined) params.append('min_orders', options.min_orders.toString());
      if (options?.min_spent !== undefined) params.append('min_spent', options.min_spent.toString());
      if (options?.city) params.append('city', options.city);
      if (options?.accepts_marketing !== undefined) params.append('accepts_marketing', options.accepts_marketing.toString());
      if (options?.last_order_before) params.append('last_order_before', options.last_order_before);

      const queryString = params.toString();
      const url = `${API_BASE_URL}/customers${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result: ApiListResponse = await response.json();
      return result.data || [];
    } catch (error: unknown) {
      logger.error('Error loading customers:', error);
      return [];
    }
  },

  getAllPaginated: async (options?: CustomerListParams): Promise<ApiPaginatedResponse<Customer>> => {
    try {
      const params = new URLSearchParams();
      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());
      if (options?.search) params.append('search', options.search);
      if (options?.sort_by) params.append('sort_by', options.sort_by);
      if (options?.sort_order) params.append('sort_order', options.sort_order);
      if (options?.min_orders !== undefined) params.append('min_orders', options.min_orders.toString());
      if (options?.min_spent !== undefined) params.append('min_spent', options.min_spent.toString());
      if (options?.city) params.append('city', options.city);
      if (options?.accepts_marketing !== undefined) params.append('accepts_marketing', options.accepts_marketing.toString());
      if (options?.last_order_before) params.append('last_order_before', options.last_order_before);

      const queryString = params.toString();
      const url = `${API_BASE_URL}/customers${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result: ApiPaginatedResponse<Customer> = await response.json();
      return {
        data: result.data || [],
        pagination: result.pagination ?? { total: 0, limit: 50, offset: 0, hasMore: false },
      };
    } catch (error: unknown) {
      logger.error('Error loading customers:', error);
      return { data: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } };
    }
  },

  getStats: async (): Promise<CustomerStatsOverview | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers/stats/overview`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result: { data: CustomerStatsOverview } = await response.json();
      return result.data;
    } catch (error: unknown) {
      logger.error('Error loading customer stats:', error);
      return null;
    }
  },

  getOrders: async (
    customerId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ApiPaginatedResponse<Order>> => {
    try {
      const params = new URLSearchParams();
      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());

      const queryString = params.toString();
      const url = `${API_BASE_URL}/customers/${customerId}/orders${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result: ApiPaginatedResponse<Order> = await response.json();
      return {
        data: result.data || [],
        pagination: result.pagination ?? { total: 0, limit: 20, offset: 0, hasMore: false },
      };
    } catch (error: unknown) {
      logger.error('Error loading customer orders:', error);
      return { data: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } };
    }
  },

  getById: async (id: string): Promise<Customer | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return undefined;
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const data: Customer = await response.json();
      return data;
    } catch (error: unknown) {
      logger.error('Error loading customer:', error);
      return undefined;
    }
  },

  create: async (customer: Omit<Customer, 'id' | 'created_at' | 'total_orders' | 'total_spent'>): Promise<Customer> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(customer),
      });
      if (!response.ok) {
        const errorData: ApiErrorResponse = await response.json();
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }
      const result: ApiSingleResponse = await response.json();
      return result.data;
    } catch (error: unknown) {
      logger.error('Error creating customer:', error);
      throw error;
    }
  },

  update: async (id: string, data: Partial<Customer>): Promise<Customer | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        if (response.status === 404) return undefined;
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result: ApiSingleResponse = await response.json();
      return result.data;
    } catch (error: unknown) {
      logger.error('Error updating customer:', error);
      return undefined;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return false;
        if (response.status === 409) {
          const errorData: ApiErrorResponse = await response.json();
          throw new Error(errorData.message || 'El cliente tiene pedidos existentes');
        }
        throw new Error(`Error HTTP: ${response.status}`);
      }
      return true;
    } catch (error: unknown) {
      logger.error('Error deleting customer:', error);
      throw error;
    }
  },

  search: async (query: string): Promise<Customer[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers/search?q=${encodeURIComponent(query)}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result: ApiListResponse = await response.json();
      return result.data || [];
    } catch (error: unknown) {
      logger.error('Error searching customers:', error);
      return [];
    }
  },
};

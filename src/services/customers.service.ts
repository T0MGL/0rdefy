import { Customer } from '@/types';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.trim();
cleanBaseURL = cleanBaseURL.replace(/(\/api\/?)+$/i, '');
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
const API_BASE_URL = `${cleanBaseURL}/api`;

// API response types
interface ApiListResponse {
  data: Customer[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}

interface ApiSingleResponse {
  data: Customer;
}

interface ApiErrorResponse {
  message?: string;
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
  getAll: async (): Promise<Customer[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result: ApiListResponse = await response.json();
      // API returns {data: [], pagination: {...}}, extract the data array
      return result.data || [];
    } catch (error: unknown) {
      console.error('Error loading customers:', error);
      return [];
    }
  },

  getById: async (id: string): Promise<Customer | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return undefined;
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: Customer = await response.json();
      return data;
    } catch (error: unknown) {
      console.error('Error loading customer:', error);
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
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }
      const result: ApiSingleResponse = await response.json();
      return result.data;
    } catch (error: unknown) {
      console.error('Error creating customer:', error);
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
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result: ApiSingleResponse = await response.json();
      return result.data;
    } catch (error: unknown) {
      console.error('Error updating customer:', error);
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
          throw new Error(errorData.message || 'Customer has existing orders');
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return true;
    } catch (error: unknown) {
      console.error('Error deleting customer:', error);
      throw error;
    }
  },

  search: async (query: string): Promise<Customer[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers/search?q=${encodeURIComponent(query)}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result: ApiListResponse = await response.json();
      return result.data || [];
    } catch (error: unknown) {
      console.error('Error searching customers:', error);
      return [];
    }
  },
};

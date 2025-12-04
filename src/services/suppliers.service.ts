import { Supplier } from '@/types';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
cleanBaseURL = cleanBaseURL.trim();
cleanBaseURL = cleanBaseURL.replace(/(\/api\/?)+$/i, '');
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
const API_BASE_URL = `${cleanBaseURL}/api`;

const getHeaders = () => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (storeId) {
    headers['X-Store-ID'] = storeId;
  }
  return headers;
};

export const suppliersService = {
  getAll: async (): Promise<Supplier[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/suppliers`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('Error loading suppliers:', error);
      return [];
    }
  },

  getById: async (id: string): Promise<Supplier | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/suppliers/${id}`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return undefined;
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error loading supplier:', error);
      return undefined;
    }
  },

  create: async (supplier: Omit<Supplier, 'id' | 'created_at' | 'updated_at' | 'products_count' | 'products_supplied'>): Promise<Supplier> => {
    try {
      const response = await fetch(`${API_BASE_URL}/suppliers`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(supplier),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result.data;
    } catch (error) {
      console.error('Error creating supplier:', error);
      throw error;
    }
  },

  update: async (id: string, data: Partial<Supplier>): Promise<Supplier | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/suppliers/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        if (response.status === 404) return undefined;
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      return result.data;
    } catch (error) {
      console.error('Error updating supplier:', error);
      return undefined;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/suppliers/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return false;
        if (response.status === 409) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Supplier has products assigned');
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return true;
    } catch (error) {
      console.error('Error deleting supplier:', error);
      throw error;
    }
  },
};

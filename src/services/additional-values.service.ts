import { AdditionalValue } from '@/types';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';

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

export const additionalValuesService = {
  async getAll(): Promise<AdditionalValue[]> {
    try {
      const response = await fetch(`${API_URL}/api/additional-values`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch additional values');
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching additional values:', error);
      // Return empty array on error
      return [];
    }
  },

  async getById(id: string): Promise<AdditionalValue | undefined> {
    try {
      const response = await fetch(`${API_URL}/api/additional-values/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) return undefined;
      return await response.json();
    } catch (error) {
      console.error('Error fetching additional value:', error);
      return undefined;
    }
  },

  async getSummary(): Promise<{ marketing: number; sales: number; employees: number; operational: number }> {
    try {
      const response = await fetch(`${API_URL}/api/additional-values/summary`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch summary');
      return await response.json();
    } catch (error) {
      console.error('Error fetching summary:', error);
      return { marketing: 0, sales: 0, employees: 0, operational: 0 };
    }
  },

  async create(data: Partial<AdditionalValue>): Promise<AdditionalValue> {
    const response = await fetch(`${API_URL}/api/additional-values`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create additional value');
    }

    const result = await response.json();
    return result.data;
  },

  async update(id: string, data: Partial<AdditionalValue>): Promise<AdditionalValue> {
    const response = await fetch(`${API_URL}/api/additional-values/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update additional value');
    }

    const result = await response.json();
    return result.data;
  },

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${API_URL}/api/additional-values/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete additional value');
    }

    return true;
  },
};

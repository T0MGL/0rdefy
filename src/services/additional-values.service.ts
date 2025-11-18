import { AdditionalValue } from '@/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const additionalValuesService = {
  async getAll(): Promise<AdditionalValue[]> {
    try {
      const response = await fetch(`${API_URL}/api/additional-values`);
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
      const response = await fetch(`${API_URL}/api/additional-values/${id}`);
      if (!response.ok) return undefined;
      return await response.json();
    } catch (error) {
      console.error('Error fetching additional value:', error);
      return undefined;
    }
  },

  async getSummary(): Promise<{ marketing: number; sales: number; employees: number; operational: number }> {
    try {
      const response = await fetch(`${API_URL}/api/additional-values/summary`);
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete additional value');
    }

    return true;
  },
};

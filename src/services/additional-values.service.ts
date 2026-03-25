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
    const response = await fetch(`${API_URL}/api/additional-values`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Error al obtener valores adicionales');
    const data = await response.json();
    return data.data || [];
  },

  async getById(id: string): Promise<AdditionalValue | undefined> {
    const response = await fetch(`${API_URL}/api/additional-values/${id}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      if (response.status === 404) return undefined;
      throw new Error('Error al obtener valor adicional');
    }
    return await response.json();
  },

  async getSummary(): Promise<{ marketing: number; sales: number; employees: number; operational: number }> {
    const response = await fetch(`${API_URL}/api/additional-values/summary`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Error al obtener resumen');
    return await response.json();
  },

  async create(data: Partial<AdditionalValue>): Promise<AdditionalValue> {
    const response = await fetch(`${API_URL}/api/additional-values`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al crear valor adicional');
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
      throw new Error(error.message || 'Error al actualizar valor adicional');
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
      throw new Error(error.message || 'Error al eliminar valor adicional');
    }

    return true;
  },
};

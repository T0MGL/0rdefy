import { Ad } from '@/types';

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

export const adsService = {
  async getAll(): Promise<Ad[]> {
    try {
      const response = await fetch(`${API_URL}/api/campaigns`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Error al obtener campañas');
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      return [];
    }
  },

  async getById(id: string): Promise<Ad | undefined> {
    try {
      const response = await fetch(`${API_URL}/api/campaigns/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) return undefined;
      return await response.json();
    } catch (error) {
      console.error('Error fetching campaign:', error);
      return undefined;
    }
  },

  async create(data: Partial<Ad>): Promise<Ad> {
    const response = await fetch(`${API_URL}/api/campaigns`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al crear campaña');
    }

    const result = await response.json();
    return result.data;
  },

  async update(id: string, data: Partial<Ad>): Promise<Ad> {
    const response = await fetch(`${API_URL}/api/campaigns/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al actualizar campaña');
    }

    const result = await response.json();
    return result.data;
  },

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${API_URL}/api/campaigns/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al eliminar campaña');
    }

    return true;
  },

  async updateStatus(id: string, status: 'active' | 'paused' | 'ended'): Promise<Ad> {
    const response = await fetch(`${API_URL}/api/campaigns/${id}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al actualizar estado de campaña');
    }

    const result = await response.json();
    return result.data;
  },
};

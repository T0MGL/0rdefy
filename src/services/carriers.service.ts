export interface Carrier {
  id: string;
  store_id?: string;
  name: string; // Nombre del repartidor
  phone?: string;
  email?: string;
  vehicle_type?: string; // moto, auto, bicicleta
  license_plate?: string;
  is_active: boolean;
  notes?: string;
  total_deliveries?: number;
  successful_deliveries?: number;
  failed_deliveries?: number;
  delivery_rate?: number;
  // Rating fields
  average_rating?: number; // Rating promedio 0-5
  total_ratings?: number; // Número total de calificaciones
  created_at?: string;
  updated_at?: string;

  // Backward compatibility with old interface
  carrier_name?: string;
  coverage_zones?: string;
  contact_phone?: string;
  contact_email?: string;
}

let API_URL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
API_URL = API_URL.trim();
API_URL = API_URL.replace(/(\/api\/?)+$/i, '');
API_URL = API_URL.replace(/\/+$/, '');

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

export const carriersService = {
  async getAll(): Promise<Carrier[]> {
    try {
      const response = await fetch(`${API_URL}/api/couriers`, {
        headers: getHeaders(),
      });
      if (!response.ok) throw new Error('Failed to fetch couriers');
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching couriers:', error);
      return [];
    }
  },

  async getById(id: string): Promise<Carrier | undefined> {
    try {
      const response = await fetch(`${API_URL}/api/couriers/${id}`, {
        headers: getHeaders(),
      });
      if (!response.ok) return undefined;
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Error fetching courier:', error);
      return undefined;
    }
  },

  async create(data: Partial<Carrier>): Promise<Carrier> {
    const response = await fetch(`${API_URL}/api/couriers`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create courier');
    }

    const result = await response.json();
    return result.data;
  },

  async update(id: string, data: Partial<Carrier>): Promise<Carrier> {
    const response = await fetch(`${API_URL}/api/couriers/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update courier');
    }

    const result = await response.json();
    return result.data;
  },

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${API_URL}/api/couriers/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete courier');
    }

    return true;
  },

  async toggleStatus(id: string): Promise<Carrier> {
    const response = await fetch(`${API_URL}/api/couriers/${id}/toggle`, {
      method: 'PATCH',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to toggle courier status');
    }

    const result = await response.json();
    return result.data;
  },
};

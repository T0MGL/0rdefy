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

export interface CarrierReview {
  id: string;
  /** Order UUID, kept explicit so the UI can link to /orders/:order_id */
  order_id: string;
  rating: number;
  comment: string | null;
  rated_at: string | null;
  order_number: string;
  customer_name: string;
  delivery_date: string | null;
}

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface CarrierReviewStats {
  total_ratings: number;
  last_30d_count: number;
  comments_count: number;
  comment_rate_percent: number;
  avg_hours_to_rate: number | null;
}

export interface CarrierReviewsResponse {
  courier: {
    id: string;
    name: string;
    average_rating: number;
    total_ratings: number;
  };
  reviews: CarrierReview[];
  rating_distribution: RatingDistribution;
  stats: CarrierReviewStats;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface CarrierReplicationTarget {
  store_id: string;
  store_name: string;
  role: 'owner' | 'admin' | null;
}

export type CarrierReplicationSkipReason =
  | 'already_exists'
  | 'source_store'
  | 'not_a_member'
  | 'permission_denied';

export interface CarrierReplicationResult {
  replicated: Array<{
    store_id: string;
    carrier_id: string;
    zones: number;
    coverage: number;
  }>;
  skipped: Array<{
    store_id: string;
    reason: CarrierReplicationSkipReason;
    existing_carrier_id?: string;
    role?: string;
  }>;
  failed: Array<{
    store_id: string;
    reason: string;
    sqlstate?: string;
  }>;
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
  async getAll(options?: { limit?: number; offset?: number }): Promise<Carrier[]> {
    const params = new URLSearchParams();
    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }
    if (options?.offset) {
      params.append('offset', options.offset.toString());
    }
    const url = `${API_URL}/api/couriers${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await fetch(url, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Error al obtener transportistas');
    const data = await response.json();
    return data.data || [];
  },

  async getById(id: string): Promise<Carrier | undefined> {
    const response = await fetch(`${API_URL}/api/couriers/${id}`, {
      headers: getHeaders(),
    });
    if (!response.ok) {
      if (response.status === 404) return undefined;
      throw new Error('Error al obtener transportista');
    }
    const data = await response.json();
    return data.data;
  },

  async create(data: Partial<Carrier>): Promise<Carrier> {
    const response = await fetch(`${API_URL}/api/couriers`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al crear transportista');
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
      throw new Error(error.message || 'Error al actualizar transportista');
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
      throw new Error(error.message || 'Error al eliminar transportista');
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
      throw new Error(error.message || 'Error al cambiar estado del transportista');
    }

    const result = await response.json();
    return result.data;
  },

  async getReviews(id: string, options?: { limit?: number; offset?: number }): Promise<CarrierReviewsResponse> {
    const params = new URLSearchParams();
    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }
    if (options?.offset) {
      params.append('offset', options.offset.toString());
    }
    const url = `${API_URL}/api/couriers/${id}/reviews${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await fetch(url, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Error al obtener reviews');
    const data = await response.json();
    return data;
  },

  async getReplicationTargets(signal?: AbortSignal): Promise<CarrierReplicationTarget[]> {
    const response = await fetch(`${API_URL}/api/couriers/replication-targets`, {
      headers: getHeaders(),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Error al obtener tiendas destino');
    }

    const data = await response.json();
    return (data?.data as CarrierReplicationTarget[]) || [];
  },

  async replicateToStores(
    id: string,
    options?: { targetStoreIds?: string[]; signal?: AbortSignal },
  ): Promise<CarrierReplicationResult> {
    const body: { target_store_ids?: string[] } = {};
    if (options?.targetStoreIds && options.targetStoreIds.length > 0) {
      body.target_store_ids = options.targetStoreIds;
    }

    const response = await fetch(`${API_URL}/api/couriers/${id}/replicate`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Error al replicar repartidor');
    }

    const result = await response.json();
    return (result?.data as CarrierReplicationResult) || {
      replicated: [],
      skipped: [],
      failed: [],
    };
  },
};

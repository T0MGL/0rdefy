// ================================================================
// CARRIER ZONES SERVICE
// ================================================================
// Manages zone-based pricing for carriers
// ================================================================

const API_URL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';

export interface CarrierZone {
  id: string;
  store_id: string;
  carrier_id: string;
  zone_name: string;
  zone_code?: string;
  rate: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CarrierZonesResponse {
  courier: {
    id: string;
    name: string;
    carrier_type: string;
  };
  zones: CarrierZone[];
  count: number;
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

export const carrierZonesService = {
  /**
   * Get all zones for a carrier
   */
  async getZonesByCarrier(carrierId: string): Promise<CarrierZonesResponse> {
    const response = await fetch(`${API_URL}/api/couriers/${carrierId}/zones`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch carrier zones');
    }

    return response.json();
  },

  /**
   * Create a new zone for a carrier
   */
  async createZone(carrierId: string, data: {
    zone_name: string;
    zone_code?: string;
    rate: number;
    is_active?: boolean;
  }): Promise<CarrierZone> {
    const response = await fetch(`${API_URL}/api/couriers/${carrierId}/zones`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create zone');
    }

    const result = await response.json();
    return result.data;
  },

  /**
   * Update a zone
   */
  async updateZone(zoneId: string, data: {
    zone_name?: string;
    zone_code?: string;
    rate?: number;
    is_active?: boolean;
  }): Promise<CarrierZone> {
    const response = await fetch(`${API_URL}/api/couriers/zones/${zoneId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update zone');
    }

    const result = await response.json();
    return result.data;
  },

  /**
   * Delete a zone
   */
  async deleteZone(zoneId: string): Promise<void> {
    const response = await fetch(`${API_URL}/api/couriers/zones/${zoneId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete zone');
    }
  },

  /**
   * Calculate shipping cost for a carrier + zone combination
   */
  async calculateShippingCost(carrierId: string, zoneName: string): Promise<{
    courier_id: string;
    zone_name: string;
    zone_code?: string;
    rate: number;
    currency: string;
  }> {
    const response = await fetch(
      `${API_URL}/api/couriers/${carrierId}/zones/calculate?zone_name=${encodeURIComponent(zoneName)}`,
      {
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to calculate shipping cost');
    }

    return response.json();
  },
};

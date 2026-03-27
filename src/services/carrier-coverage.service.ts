// ================================================================
// CARRIER COVERAGE SERVICE
// ================================================================
// Manages city-based coverage configuration for carriers
// ================================================================

let API_URL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
API_URL = API_URL.trim().replace(/(\/api\/?)+$/i, '').replace(/\/+$/, '');

export interface LocationCity {
  city: string;
  department: string;
  zone_code: string;
}

export interface GroupedLocationsResponse {
  gran_asuncion: {
    cities: LocationCity[];
    count: number;
  };
  interior: {
    departments: Record<string, LocationCity[]>;
    count: number;
  };
  total: number;
}

export interface CoverageRow {
  id: string;
  city: string;
  department: string;
  rate: number | null;
  is_active: boolean;
}

export interface CoverageAllResponse {
  data: CoverageRow[];
  coverage_map: Record<string, { rate: number | null; is_active: boolean }>;
  count: number;
}

export interface BulkCoverageItem {
  city: string;
  department: string;
  rate: number | null;
}

const getHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};

export const carrierCoverageService = {
  /**
   * Get all Paraguay cities grouped by Gran Asuncion and Interior departments
   */
  async getGroupedLocations(signal?: AbortSignal): Promise<GroupedLocationsResponse> {
    const response = await fetch(`${API_URL}/api/carriers/locations/grouped`, {
      headers: getHeaders(),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al obtener ciudades');
    }

    return response.json();
  },

  /**
   * Get all coverage rows for a carrier (lightweight, for pre-fill)
   */
  async getCoverageAll(carrierId: string, signal?: AbortSignal): Promise<CoverageAllResponse> {
    const response = await fetch(`${API_URL}/api/carriers/${carrierId}/coverage/all`, {
      headers: getHeaders(),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al obtener cobertura');
    }

    return response.json();
  },

  /**
   * Bulk upsert coverage for a carrier
   */
  async saveBulkCoverage(carrierId: string, coverage: BulkCoverageItem[]): Promise<{ count: number }> {
    const response = await fetch(`${API_URL}/api/carriers/${carrierId}/coverage/bulk`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ coverage }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al guardar cobertura');
    }

    return response.json();
  },
};

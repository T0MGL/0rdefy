import { useQuery } from '@tanstack/react-query';
import { getActiveStoreId } from '@/lib/activeStore';

export interface CarrierWithCoverage {
  carrier_id: string;
  carrier_name: string;
  carrier_phone: string | null;
  rate: number | null;
  zone_code: string;
  has_coverage: boolean;
}

const API_BASE_URL = `${import.meta.env.VITE_API_URL || 'https://api.ordefy.io'}/api`;

// Frozen empty-array reference for the nullish state. `query.data ?? []` mints a
// new array every render while data is undefined, destabilizing any consumer
// that depends on `carriers` by reference in a memo/effect dep array.
const EMPTY_CARRIERS: CarrierWithCoverage[] = [];

const DIACRITICS_REGEX = /[̀-ͯ]/g;

function normalizeCity(value: string): string {
  return value.normalize('NFD').replace(DIACRITICS_REGEX, '').toLowerCase().trim();
}

async function fetchCarriersForCity(
  city: string,
  signal: AbortSignal,
): Promise<CarrierWithCoverage[]> {
  const token = localStorage.getItem('auth_token');
  const storeId = getActiveStoreId();

  const url = `${API_BASE_URL}/carriers/coverage/city?city=${encodeURIComponent(city)}`;

  const response = await fetch(url, {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Store-ID': storeId || '',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch coverage: ${response.status}`);
  }

  const payload = await response.json();
  const rows: CarrierWithCoverage[] = Array.isArray(payload?.data) ? payload.data : [];

  return rows
    .filter((c) => c.has_coverage)
    .sort((a, b) => {
      if (a.rate == null) return 1;
      if (b.rate == null) return -1;
      return a.rate - b.rate;
    });
}

export function useCarriersWithCoverage(
  city: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const trimmedCity = city?.trim() || '';
  const enabled = Boolean(options?.enabled ?? true) && Boolean(trimmedCity);

  const query = useQuery({
    queryKey: ['carriers-coverage', normalizeCity(trimmedCity)],
    queryFn: ({ signal }) => fetchCarriersForCity(trimmedCity, signal),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  return {
    carriers: query.data ?? EMPTY_CARRIERS,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

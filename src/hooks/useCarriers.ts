import { useQuery } from '@tanstack/react-query';
import { carriersService, Carrier } from '@/services/carriers.service';

/**
 * Centralized hook for fetching and caching carriers
 * Uses React Query to share data across components and reduce API calls
 */
export function useCarriers(options?: {
  enabled?: boolean;
  activeOnly?: boolean;
}) {
  const { enabled = true, activeOnly = false } = options || {};

  const query = useQuery({
    queryKey: ['carriers', { activeOnly }],
    queryFn: async () => {
      const carriers = await carriersService.getAll();
      return activeOnly ? carriers.filter(c => c.is_active) : carriers;
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes - carriers don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  });

  // Helper to get carrier name by ID
  const getCarrierName = (carrierIdOrName: string): string => {
    if (!carrierIdOrName || !query.data) return '';

    // Check if it's a UUID (carrier_id)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(carrierIdOrName);

    if (isUUID) {
      const carrier = query.data.find(c => c.id === carrierIdOrName);
      return carrier?.name || carrierIdOrName;
    }

    // It's already a name, return as is
    return carrierIdOrName;
  };

  // Helper to get carrier by ID
  const getCarrierById = (id: string): Carrier | undefined => {
    return query.data?.find(c => c.id === id);
  };

  return {
    carriers: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    getCarrierName,
    getCarrierById,
  };
}

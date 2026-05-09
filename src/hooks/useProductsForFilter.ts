import { useQuery } from '@tanstack/react-query';
import { productsService } from '@/services/products.service';

export interface ProductFilterOption {
  id: string;
  name: string;
  image: string;
  sku: string;
}

/**
 * Lightweight products list shaped for the ProductMultiSelect filter
 * (id + name + image + sku). Cached for 5 minutes since products do not
 * change often relative to a filter session. Limit is 500: any store with
 * more than that is large enough to need a search-driven endpoint, which
 * we will add when there is a real customer past that threshold.
 */
export function useProductsForFilter() {
  return useQuery({
    queryKey: ['products-filter'],
    queryFn: async () => {
      const result = await productsService.getAll({ source: 'local', limit: 500 });
      return (result.data || []).map((p): ProductFilterOption => ({
        id: p.id,
        name: p.name,
        image: p.image || '',
        sku: p.sku || '',
      }));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

import { QueryClient } from "@tanstack/react-query";

/**
 * Per-store QueryClient registry (per browser tab).
 *
 * Each store gets its own QueryClient so switching stores swaps the active
 * cache instead of clearing it: each store keeps an isolated cache, returning
 * to a store is instant, and data from store A can never bleed into store B's
 * views because they never share a cache. The '__none__' client serves
 * public / pre-auth routes.
 *
 * Lives in its own module (not App.tsx) so AuthContext can call
 * resetStoreQueryClients() on logout without an App <-> AuthContext import cycle.
 */

export const NO_STORE_KEY = "__none__";

// Optimized configuration for production cost control.
const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes - longer cache reduces API calls
        gcTime: 1000 * 60 * 10, // 10 minutes - keeps recently accessed data in memory
        refetchOnWindowFocus: false, // prevents duplicate requests on tab focus
        refetchOnReconnect: true, // important for network recovery
        retry: 1,
      },
    },
  });

const storeQueryClients = new Map<string, QueryClient>();

export function getQueryClientForStore(storeId: string): QueryClient {
  let client = storeQueryClients.get(storeId);
  if (!client) {
    client = createQueryClient();
    storeQueryClients.set(storeId, client);
  }
  return client;
}

/**
 * Purge every store's cached data and drop the clients. Call on logout so
 * cached PII (orders, customers, settlements) does not survive in the JS heap
 * for the life of the tab after the session ends.
 */
export function resetStoreQueryClients(): void {
  for (const client of storeQueryClients.values()) {
    try {
      client.clear();
    } catch {
      // ignore: best-effort cache purge
    }
  }
  storeQueryClients.clear();
}

export const defaultQueryClient = getQueryClientForStore(NO_STORE_KEY);

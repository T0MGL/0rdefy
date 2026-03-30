// In-memory cache of Shopify domains with no matching integration.
// Prevents repeated DB lookups for phantom stores that flood the API.
// TTL: 1 hour. After expiry the next request will re-check the DB,
// so if the integration is created later it will be picked up.

const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map<string, number>();

export const unknownDomainCache = {
  has(domain: string): boolean {
    const expiry = cache.get(domain);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      cache.delete(domain);
      return false;
    }
    return true;
  },

  add(domain: string): void {
    cache.set(domain, Date.now() + CACHE_TTL_MS);
  },

  remove(domain: string): void {
    cache.delete(domain);
  },

  size(): number {
    return cache.size;
  },
};

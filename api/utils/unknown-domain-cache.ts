// In-memory cache of Shopify domains with no matching integration.
// Prevents repeated DB lookups for phantom stores that flood the API.
// TTL: 1 hour. After expiry the next request will re-check the DB,
// so if the integration is created later it will be picked up.

const CACHE_TTL_MS = 60 * 60 * 1000;

// Hard ceiling on tracked domains. An attacker can spray distinct
// X-Shopify-Shop-Domain headers to grow this Map without bound; the cap
// turns it into a bounded LRU-ish set (oldest-inserted evicted first).
const MAX_ENTRIES = 5000;

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
    // Re-insert moves the key to the tail (Map preserves insertion order),
    // so the eviction below always drops the least-recently-added entry.
    if (cache.has(domain)) cache.delete(domain);
    cache.set(domain, Date.now() + CACHE_TTL_MS);
    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  },

  remove(domain: string): void {
    cache.delete(domain);
  },

  size(): number {
    return cache.size;
  },
};

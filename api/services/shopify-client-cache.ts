// Shopify Client Cache - Singleton pattern per integration
// Prevents memory leaks from creating new AxiosInstance + TokenBucket + GraphQL clients per request
// With 100 concurrent users, this reduces thousands of instances to one per unique integration

import { logger } from '../utils/logger';
import { ShopifyClientService } from './shopify-client.service';
import { ShopifyIntegration } from '../types/shopify';

interface CachedClient {
  client: ShopifyClientService;
  createdAt: number;
  lastUsedAt: number;
  accessToken: string; // Track token for invalidation
}

// Cache configuration
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes - clients expire if not used
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup every 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum cached clients (safety limit)

// Client cache keyed by integration ID
const clientCache = new Map<string, CachedClient>();

// Cleanup interval reference
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Get or create a ShopifyClientService for the given integration.
 * Uses singleton pattern to reuse clients across requests.
 *
 * @param integration - The Shopify integration configuration
 * @returns ShopifyClientService instance (may be cached)
 */
export function getShopifyClient(integration: ShopifyIntegration): ShopifyClientService {
  const key = integration.id;
  const cached = clientCache.get(key);

  // Return cached client if valid
  if (cached) {
    // Check if access token changed (integration was updated)
    if (cached.accessToken === integration.access_token) {
      cached.lastUsedAt = Date.now();
      return cached.client;
    }
    // Token changed, invalidate this client
    logger.info('BACKEND', `[ShopifyClientCache] Token changed for integration ${key}, creating new client`);
    clientCache.delete(key);
  }

  // Create new client
  const client = new ShopifyClientService(integration);
  const now = Date.now();

  // Enforce max cache size (LRU eviction)
  if (clientCache.size >= MAX_CACHE_SIZE) {
    evictLeastRecentlyUsed();
  }

  clientCache.set(key, {
    client,
    createdAt: now,
    lastUsedAt: now,
    accessToken: integration.access_token
  });

  logger.info('BACKEND', `[ShopifyClientCache] Created new client for integration ${key} (cache size: ${clientCache.size})`);

  // Start cleanup interval if not already running
  ensureCleanupInterval();

  return client;
}

/**
 * Invalidate cached client for a specific integration.
 * Call this when integration credentials are updated or deleted.
 *
 * @param integrationId - The integration ID to invalidate
 */
export function invalidateShopifyClient(integrationId: string): void {
  if (clientCache.has(integrationId)) {
    clientCache.delete(integrationId);
    logger.info('BACKEND', `[ShopifyClientCache] Invalidated client for integration ${integrationId}`);
  }
}

/**
 * Invalidate all cached clients for a specific store.
 * Call this when a store disconnects from Shopify.
 *
 * @param storeId - The store ID
 */
export function invalidateStoreClients(storeId: string): void {
  // Note: We'd need to track store_id -> integration_id mappings
  // For now, this is a placeholder - can be enhanced if needed
  logger.info('BACKEND', `[ShopifyClientCache] Store client invalidation requested for ${storeId}`);
}

/**
 * Clear all cached clients.
 * Useful for testing or graceful shutdown.
 */
export function clearShopifyClientCache(): void {
  const count = clientCache.size;
  clientCache.clear();
  logger.info('BACKEND', `[ShopifyClientCache] Cleared ${count} cached clients`);
}

/**
 * Get cache statistics for monitoring.
 */
export function getShopifyClientCacheStats(): {
  size: number;
  maxSize: number;
  ttlMs: number;
  clients: Array<{ integrationId: string; ageMs: number; lastUsedMs: number }>;
} {
  const now = Date.now();
  const clients: Array<{ integrationId: string; ageMs: number; lastUsedMs: number }> = [];

  clientCache.forEach((cached, key) => {
    clients.push({
      integrationId: key,
      ageMs: now - cached.createdAt,
      lastUsedMs: now - cached.lastUsedAt
    });
  });

  return {
    size: clientCache.size,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL_MS,
    clients
  };
}

// Internal: Evict least recently used client
function evictLeastRecentlyUsed(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  clientCache.forEach((cached, key) => {
    if (cached.lastUsedAt < oldestTime) {
      oldestTime = cached.lastUsedAt;
      oldestKey = key;
    }
  });

  if (oldestKey) {
    clientCache.delete(oldestKey);
    logger.info('BACKEND', `[ShopifyClientCache] Evicted LRU client for integration ${oldestKey}`);
  }
}

// Internal: Remove expired clients
function cleanupExpiredClients(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];

  clientCache.forEach((cached, key) => {
    if (now - cached.lastUsedAt > CACHE_TTL_MS) {
      expiredKeys.push(key);
    }
  });

  expiredKeys.forEach(key => clientCache.delete(key));

  if (expiredKeys.length > 0) {
    logger.info('BACKEND', `[ShopifyClientCache] Cleaned up ${expiredKeys.length} expired clients (remaining: ${clientCache.size})`);
  }
}

// Internal: Ensure cleanup interval is running
function ensureCleanupInterval(): void {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupExpiredClients, CACHE_CLEANUP_INTERVAL_MS);
    // Don't prevent Node.js from exiting
    cleanupInterval.unref();
  }
}

// Stop cleanup interval (for testing/shutdown)
export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

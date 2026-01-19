/**
 * Utility functions for handling navigation in Shopify embedded apps
 * Ensures that required Shopify query parameters (shop, host, embedded) are preserved
 * during navigation to prevent App Bridge initialization errors
 */

/**
 * Preserves Shopify query parameters when navigating to a new route
 * @param path - The path to navigate to (e.g., '/', '/orders')
 * @returns The path with Shopify query parameters appended if present
 */
export function preserveShopifyParams(path: string): string {
  const urlParams = new URLSearchParams(window.location.search);
  const shop = urlParams.get('shop');
  const host = urlParams.get('host');
  const embedded = urlParams.get('embedded');

  // If no Shopify params are present, return the path as-is (standalone mode)
  if (!shop && !host && !embedded) {
    return path;
  }

  // Build query string with Shopify parameters
  const params = new URLSearchParams();

  if (shop) params.set('shop', shop);
  if (host) params.set('host', host);
  if (embedded) params.set('embedded', embedded);

  // Check if path already has query parameters
  const [pathname, existingQuery] = path.split('?');

  // Merge existing params with Shopify params
  if (existingQuery) {
    const existingParams = new URLSearchParams(existingQuery);
    existingParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

/**
 * Checks if the app is running in Shopify embedded mode
 * @returns true if running in Shopify iframe, false otherwise
 */
export function isShopifyEmbedded(): boolean {
  const urlParams = new URLSearchParams(window.location.search);
  const embedded = urlParams.get('embedded');
  const host = urlParams.get('host');

  return embedded === '1' || !!host;
}

/**
 * Gets the shop domain from URL parameters
 * @returns The shop domain (e.g., 'store.myshopify.com') or null if not found
 */
export function getShopDomain(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  let shop = urlParams.get('shop');

  // If shop is not directly available, try decoding from host parameter
  if (!shop) {
    const host = urlParams.get('host');
    if (host) {
      try {
        const decodedHost = atob(host);
        shop = decodedHost.split('/')[0];
      } catch (e) {
        logger.warn('[Shopify] Could not decode host parameter:', e);
      }
    }
  }

  return shop;
}

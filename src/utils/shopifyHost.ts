// ================================================================
// Pure helpers for parsing Shopify embedded host parameters.
// ----------------------------------------------------------------
// Extracted so they can be unit-tested without a DOM / iframe. The
// runtime values live on `window.location.search`; tests pass strings
// directly.
// ================================================================

/**
 * Shopify embedded apps receive a base64-encoded `host` query param.
 * Two formats are observed in production:
 *   - `<shop>.myshopify.com/admin` (legacy iframe entrypoint)
 *   - `admin.shopify.com/store/<handle>` (unified admin)
 *
 * Only the first form carries the canonical shop domain that the
 * Token Exchange route can use as a guard. Returns null when the
 * input is missing, not base64, or in the unified-admin format.
 */
export function decodeHostShop(host: string | null | undefined): string | null {
  if (!host) return null;
  let decoded: string;
  try {
    decoded =
      typeof atob === 'function'
        ? atob(host)
        : // Node test runtime
          Buffer.from(host, 'base64').toString('utf-8');
  } catch {
    return null;
  }

  if (!decoded.includes('.myshopify.com')) {
    return null;
  }

  const shop = decoded.split('/')[0];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    return null;
  }
  return shop;
}

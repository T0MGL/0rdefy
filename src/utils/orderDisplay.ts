/**
 * Get the display ID for an order
 * Priority:
 * 1. shopify_order_name (e.g., "#1001")
 * 2. shopify_order_number (e.g., "1001" -> "#1001")
 * 3. shopify_order_id (e.g., "5678" -> "SH#5678")
 * 4. UUID fallback (e.g., "a1b2c3d4" -> "OR#a1b2c3d4")
 */
export function getOrderDisplayId(order: {
  id: string;
  shopify_order_name?: string;
  shopify_order_number?: string;
  shopify_order_id?: string;
}): string {
  if (order.shopify_order_name) {
    return order.shopify_order_name;
  }

  if (order.shopify_order_number) {
    return `#${order.shopify_order_number}`;
  }

  if (order.shopify_order_id) {
    return `SH#${order.shopify_order_id}`;
  }

  return `OR#${order.id.substring(0, 8)}`;
}

/**
 * Get unified display order number - always #XXXX format
 * Used for settlements reconciliation to avoid confusion
 * Priority:
 * 1. shopify_order_name (e.g., "#1001")
 * 2. shopify_order_number (e.g., "1001" -> "#1001")
 * 3. Last 4 chars of UUID (e.g., "a1b2c3d4-..." -> "#C3D4")
 *
 * Note: Never uses "ORD-" or "SH#" prefixes for cleaner UX
 */
export function getUnifiedOrderNumber(order: {
  id: string;
  shopify_order_name?: string | null;
  shopify_order_number?: string | number | null;
  display_order_number?: string; // Pre-computed from backend
}): string {
  // If backend already computed it, use that
  if (order.display_order_number) {
    return order.display_order_number;
  }

  // Priority 1: Shopify order name (#1315 format)
  if (order.shopify_order_name) {
    return order.shopify_order_name;
  }

  // Priority 2: Shopify order number as #XXXX
  if (order.shopify_order_number) {
    return `#${order.shopify_order_number}`;
  }

  // Priority 3: Last 4 chars of UUID as #XXXX
  return `#${order.id.slice(-4).toUpperCase()}`;
}

/**
 * Get the short display ID for an order (without prefix)
 */
export function getOrderShortId(order: {
  id: string;
  shopify_order_name?: string;
  shopify_order_number?: string;
  shopify_order_id?: string;
}): string {
  if (order.shopify_order_name) {
    return order.shopify_order_name.replace(/^#/, '');
  }

  if (order.shopify_order_number) {
    return order.shopify_order_number;
  }

  if (order.shopify_order_id) {
    return order.shopify_order_id;
  }

  return order.id.substring(0, 8);
}

/**
 * Tour Target Selectors
 *
 * Centralized definition of all tour target selectors.
 * Each target has a unique data-tour-target attribute that can be
 * added to UI elements for spotlight highlighting.
 *
 * Usage:
 * 1. Add data-tour-target="orders-page" to the element
 * 2. Reference TOUR_TARGETS.ORDERS_PAGE in tour step definitions
 *
 * @module tourTargets
 */

export const TOUR_TARGETS = {
  // Sidebar navigation items
  SIDEBAR_ORDERS: '[data-tour-target="sidebar-orders"]',
  SIDEBAR_PRODUCTS: '[data-tour-target="sidebar-products"]',
  SIDEBAR_WAREHOUSE: '[data-tour-target="sidebar-warehouse"]',
  SIDEBAR_CARRIERS: '[data-tour-target="sidebar-carriers"]',
  SIDEBAR_CUSTOMERS: '[data-tour-target="sidebar-customers"]',
  SIDEBAR_MERCHANDISE: '[data-tour-target="sidebar-merchandise"]',
  SIDEBAR_RETURNS: '[data-tour-target="sidebar-returns"]',
  SIDEBAR_SETTLEMENTS: '[data-tour-target="sidebar-settlements"]',
  SIDEBAR_INTEGRATIONS: '[data-tour-target="sidebar-integrations"]',
  SIDEBAR_ADS: '[data-tour-target="sidebar-ads"]',
  SIDEBAR_SUPPLIERS: '[data-tour-target="sidebar-suppliers"]',
  SIDEBAR_DASHBOARD: '[data-tour-target="sidebar-dashboard"]',

  // Page headers and action buttons
  PAGE_HEADER: '[data-tour-target="page-header"]',
  NEW_ORDER_BUTTON: '[data-tour-target="new-order-button"]',
  NEW_PRODUCT_BUTTON: '[data-tour-target="new-product-button"]',
  NEW_CARRIER_BUTTON: '[data-tour-target="new-carrier-button"]',
  CREATE_SESSION_BUTTON: '[data-tour-target="create-session-button"]',

  // Tables and lists
  ORDERS_TABLE: '[data-tour-target="orders-table"]',
  PRODUCTS_TABLE: '[data-tour-target="products-table"]',
  WAREHOUSE_SESSIONS: '[data-tour-target="warehouse-sessions"]',

  // Specific demo elements
  DEMO_ORDER: '[data-tour-target="demo-order"]',
  DEMO_PRODUCT: '[data-tour-target="demo-product"]',

  // Page sections
  DASHBOARD_METRICS: '[data-tour-target="dashboard-metrics"]',
  DASHBOARD_ALERTS: '[data-tour-target="dashboard-alerts"]',

  // Integrations
  SHOPIFY_CONNECT: '[data-tour-target="shopify-connect"]',
} as const;

export type TourTarget = typeof TOUR_TARGETS[keyof typeof TOUR_TARGETS];

/**
 * Map of route paths to sidebar tour targets
 * Used to auto-highlight the sidebar item when navigating to a page
 */
export const ROUTE_TO_SIDEBAR_TARGET: Record<string, TourTarget> = {
  '/orders': TOUR_TARGETS.SIDEBAR_ORDERS,
  '/products': TOUR_TARGETS.SIDEBAR_PRODUCTS,
  '/warehouse': TOUR_TARGETS.SIDEBAR_WAREHOUSE,
  '/carriers': TOUR_TARGETS.SIDEBAR_CARRIERS,
  '/customers': TOUR_TARGETS.SIDEBAR_CUSTOMERS,
  '/merchandise': TOUR_TARGETS.SIDEBAR_MERCHANDISE,
  '/returns': TOUR_TARGETS.SIDEBAR_RETURNS,
  '/settlements': TOUR_TARGETS.SIDEBAR_SETTLEMENTS,
  '/integrations': TOUR_TARGETS.SIDEBAR_INTEGRATIONS,
  '/ads': TOUR_TARGETS.SIDEBAR_ADS,
  '/suppliers': TOUR_TARGETS.SIDEBAR_SUPPLIERS,
  '/': TOUR_TARGETS.SIDEBAR_DASHBOARD,
};

/**
 * Helper to get the sidebar target for a route
 */
export function getSidebarTargetForRoute(route: string): TourTarget | null {
  return ROUTE_TO_SIDEBAR_TARGET[route] || null;
}

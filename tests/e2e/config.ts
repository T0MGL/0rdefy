/**
 * Ordefy E2E Test Configuration
 *
 * PRODUCTION ENVIRONMENT - Handle with care!
 * All test data must use TEST_E2E_ prefix for identification and cleanup
 */

export const CONFIG = {
  // Production API endpoints
  apiUrl: 'https://api.ordefy.io/api',
  frontendUrl: 'https://app.ordefy.io',

  // Test credentials (owner account)
  credentials: {
    email: 'gaston@thebrightidea.ai',
    password: 'rorito28'
  },

  // Test data identification
  testPrefix: 'TEST_E2E_',

  // Timeouts
  timeout: 30000,
  requestTimeout: 10000,

  // Retry configuration
  retries: {
    max: 3,
    delay: 1000
  },

  // Rate limiting (respect production limits)
  rateLimiting: {
    requestsPerSecond: 5,
    delayBetweenRequests: 200
  }
} as const;

// Test data prefixes for different entity types
export const TEST_PREFIXES = {
  product: `${CONFIG.testPrefix}Producto_`,
  customer: `${CONFIG.testPrefix}Cliente_`,
  carrier: `${CONFIG.testPrefix}Carrier_`,
  order: `${CONFIG.testPrefix}Orden_`,
  sku: `${CONFIG.testPrefix}SKU_`,
  session: `${CONFIG.testPrefix}Session_`
} as const;

// Order status flow for reference
export const ORDER_STATUS_FLOW = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PREPARATION: 'in_preparation',
  READY_TO_SHIP: 'ready_to_ship',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  RETURNED: 'returned'
} as const;

// Stock decrement happens at this status
export const STOCK_DECREMENT_STATUS = ORDER_STATUS_FLOW.READY_TO_SHIP;

// Stock restoration happens when cancelled/rejected after decrement
export const STOCK_RESTORE_STATUSES = [
  ORDER_STATUS_FLOW.CANCELLED
] as const;

export type OrderStatus = typeof ORDER_STATUS_FLOW[keyof typeof ORDER_STATUS_FLOW];

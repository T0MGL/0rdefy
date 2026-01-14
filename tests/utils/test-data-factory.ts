/**
 * Test Data Factory for E2E Tests
 *
 * Generates test data with TEST_E2E_ prefix for easy identification
 * and cleanup in production environment.
 *
 * IMPORTANT: All generated data must be deletable and traceable!
 */

import { CONFIG, TEST_PREFIXES } from '../e2e/config';

// Unique identifier for this test run
const TEST_RUN_ID = Date.now();
let sequenceCounter = 0;

/**
 * Generate a unique sequence number for this test run
 */
function nextSequence(): number {
  return ++sequenceCounter;
}

/**
 * Generate a unique identifier combining timestamp and sequence
 */
function uniqueId(): string {
  return `${TEST_RUN_ID}_${nextSequence()}`;
}

/**
 * Test data generators
 */
export const TestData = {
  /**
   * Generate test product data
   */
  product: (overrides: Partial<ProductData> = {}): ProductData => ({
    name: `${TEST_PREFIXES.product}${uniqueId()}`,
    sku: `${TEST_PREFIXES.sku}${uniqueId()}`,
    price: 50000,
    cost: 25000,
    stock: 100,
    category: 'Test',
    description: `E2E Test Product - Run ${TEST_RUN_ID}`,
    is_active: true,
    ...overrides
  }),

  /**
   * Generate test customer data
   */
  customer: (overrides: Partial<CustomerData> = {}): CustomerData => ({
    name: `${TEST_PREFIXES.customer}${uniqueId()}`,
    phone: `+595981${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
    email: `test_e2e_${uniqueId()}@test.ordefy.io`,
    address: `Direccion de Prueba E2E - ${uniqueId()}`,
    city: 'Asuncion',
    neighborhood: 'Centro',
    notes: `E2E Test Customer - Run ${TEST_RUN_ID}`,
    ...overrides
  }),

  /**
   * Generate test carrier data
   * Note: API uses 'carrier_name' field, not 'name'
   */
  carrier: (overrides: Partial<CarrierData> = {}): CarrierData => ({
    carrier_name: `${TEST_PREFIXES.carrier}${uniqueId()}`,
    contact_phone: `+595982${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
    contact_email: `carrier_e2e_${uniqueId()}@test.ordefy.io`,
    is_active: true,
    coverage_zones: ['Asuncion', 'Central'],
    settings: { notes: `E2E Test Carrier - Run ${TEST_RUN_ID}` },
    ...overrides
  }),

  /**
   * Generate test order data
   *
   * API expects:
   * - Customer fields directly (customer_phone, customer_first_name, etc.)
   * - courier_id (not carrier_id)
   * - line_items array (not items)
   */
  order: (
    customer: CustomerData,
    courierId: string,
    lineItems: OrderLineItem[],
    overrides: Partial<OrderData> = {}
  ): OrderData => ({
    customer_phone: customer.phone,
    customer_email: customer.email,
    customer_first_name: customer.name.split(' ')[0],
    customer_last_name: customer.name.split(' ').slice(1).join(' ') || 'Test',
    customer_address: customer.address,
    courier_id: courierId,
    line_items: lineItems,
    payment_method: 'cash',
    total_price: lineItems.reduce((sum, item) => sum + (item.quantity * item.price), 0),
    ...overrides
  }),

  /**
   * Generate a simple order line item
   *
   * API expects: product_id, name, quantity, price
   */
  orderItem: (
    productId: string,
    productName: string,
    quantity: number = 1,
    price: number = 50000
  ): OrderLineItem => ({
    product_id: productId,
    name: productName,
    quantity,
    price
  }),

  /**
   * Generate test supplier data
   */
  supplier: (overrides: Partial<SupplierData> = {}): SupplierData => ({
    name: `${CONFIG.testPrefix}Proveedor_${uniqueId()}`,
    contact_name: `Contacto E2E ${uniqueId()}`,
    phone: `+595983${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
    email: `supplier_e2e_${uniqueId()}@test.ordefy.io`,
    address: `Direccion Proveedor E2E - ${uniqueId()}`,
    notes: `E2E Test Supplier - Run ${TEST_RUN_ID}`,
    ...overrides
  }),

  /**
   * Generate inbound shipment data
   */
  inboundShipment: (
    supplierId: string,
    items: InboundShipmentItem[],
    overrides: Partial<InboundShipmentData> = {}
  ): InboundShipmentData => ({
    supplier_id: supplierId,
    items,
    notes: `${CONFIG.testPrefix}Mercaderia E2E - Run ${TEST_RUN_ID}`,
    expected_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    ...overrides
  }),

  /**
   * Generate carrier zone data
   */
  carrierZone: (
    carrierId: string,
    overrides: Partial<CarrierZoneData> = {}
  ): CarrierZoneData => ({
    carrier_id: carrierId,
    zone_name: `${CONFIG.testPrefix}Zona_${uniqueId()}`,
    city: 'Asuncion',
    rate_cod: 25000,
    rate_prepaid: 20000,
    is_active: true,
    ...overrides
  }),

  /**
   * Get the current test run ID (for filtering/cleanup)
   */
  getTestRunId: (): number => TEST_RUN_ID,

  /**
   * Reset sequence counter (for test isolation)
   */
  resetSequence: (): void => {
    sequenceCounter = 0;
  }
};

// Type definitions
export interface ProductData {
  name: string;
  sku: string;
  price: number;
  cost: number;
  stock: number;
  category?: string;
  description?: string;
  is_active?: boolean;
  image_url?: string;
}

export interface CustomerData {
  name: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  neighborhood?: string;
  notes?: string;
  document_number?: string;
}

export interface CarrierData {
  carrier_name: string;
  contact_phone?: string;
  contact_email?: string;
  is_active?: boolean;
  coverage_zones?: string[];
  settings?: Record<string, any>;
  api_key?: string;
}

export interface OrderLineItem {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  variant_title?: string;
  sku?: string;
}

// Legacy alias for backward compatibility
export type OrderItem = OrderLineItem;

export interface OrderData {
  customer_phone: string;
  customer_email?: string;
  customer_first_name: string;
  customer_last_name?: string;
  customer_address: string;
  courier_id: string;
  line_items: OrderLineItem[];
  payment_method?: string;
  total_price?: number;
  shipping_address?: string;
  notes?: string;
}

export interface SupplierData {
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface InboundShipmentItem {
  product_id: string;
  quantity: number;
  unit_cost?: number;
}

export interface InboundShipmentData {
  supplier_id: string;
  items: InboundShipmentItem[];
  notes?: string;
  expected_date?: string;
}

export interface CarrierZoneData {
  carrier_id: string;
  zone_name: string;
  city: string;
  rate_cod: number;
  rate_prepaid: number;
  is_active?: boolean;
}

/**
 * Batch data generation for complex scenarios
 */
export const TestDataBatch = {
  /**
   * Generate a complete order setup (carrier, customer, products, order)
   */
  completeOrderSetup: (
    productCount: number = 1,
    orderQuantity: number = 5
  ): {
    carrier: CarrierData;
    customer: CustomerData;
    products: ProductData[];
    orderData: (customerId: string, carrierId: string, productIds: string[]) => OrderData;
  } => {
    const products: ProductData[] = [];
    for (let i = 0; i < productCount; i++) {
      products.push(TestData.product({ stock: 100 }));
    }

    return {
      carrier: TestData.carrier(),
      customer: TestData.customer(),
      products,
      orderData: (customerId: string, carrierId: string, productIds: string[]) =>
        TestData.order(
          customerId,
          carrierId,
          productIds.map(id => TestData.orderItem(id, orderQuantity, 50000))
        )
    };
  },

  /**
   * Generate warehouse test setup (multiple orders ready for picking)
   */
  warehouseSetup: (
    orderCount: number = 2,
    productsPerOrder: number = 2
  ): {
    carrier: CarrierData;
    customer: CustomerData;
    products: ProductData[];
    orders: (customerId: string, carrierId: string, productIds: string[]) => OrderData[];
  } => {
    const products: ProductData[] = [];
    for (let i = 0; i < productsPerOrder; i++) {
      products.push(TestData.product({ stock: 50, name: `${TEST_PREFIXES.product}WH_${i}_${uniqueId()}` }));
    }

    return {
      carrier: TestData.carrier(),
      customer: TestData.customer(),
      products,
      orders: (customerId: string, carrierId: string, productIds: string[]) => {
        const orders: OrderData[] = [];
        for (let i = 0; i < orderCount; i++) {
          orders.push(
            TestData.order(
              customerId,
              carrierId,
              productIds.map((id, idx) => TestData.orderItem(id, idx + 2, 50000)),
              { notes: `${CONFIG.testPrefix}Order_WH_${i}_${uniqueId()}` }
            )
          );
        }
        return orders;
      }
    };
  },

  /**
   * Generate returns test setup (delivered orders ready for return)
   */
  returnsSetup: (
    orderCount: number = 2
  ): {
    carrier: CarrierData;
    customer: CustomerData;
    products: ProductData[];
    orders: (customerId: string, carrierId: string, productIds: string[]) => OrderData[];
  } => {
    const products = [
      TestData.product({ stock: 100, name: `${TEST_PREFIXES.product}Return_${uniqueId()}` })
    ];

    return {
      carrier: TestData.carrier(),
      customer: TestData.customer(),
      products,
      orders: (customerId: string, carrierId: string, productIds: string[]) => {
        const orders: OrderData[] = [];
        for (let i = 0; i < orderCount; i++) {
          orders.push(
            TestData.order(
              customerId,
              carrierId,
              [TestData.orderItem(productIds[0], 3, 50000)],
              { notes: `${CONFIG.testPrefix}Order_Return_${i}_${uniqueId()}` }
            )
          );
        }
        return orders;
      }
    };
  }
};

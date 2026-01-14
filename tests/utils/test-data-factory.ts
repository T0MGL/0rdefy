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
   */
  carrier: (overrides: Partial<CarrierData> = {}): CarrierData => ({
    name: `${TEST_PREFIXES.carrier}${uniqueId()}`,
    phone: `+595982${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`,
    email: `carrier_e2e_${uniqueId()}@test.ordefy.io`,
    is_active: true,
    notes: `E2E Test Carrier - Run ${TEST_RUN_ID}`,
    ...overrides
  }),

  /**
   * Generate test order data
   */
  order: (
    customerId: string,
    carrierId: string,
    items: OrderItem[],
    overrides: Partial<OrderData> = {}
  ): OrderData => ({
    customer_id: customerId,
    carrier_id: carrierId,
    items,
    payment_method: 'cash',
    notes: `${CONFIG.testPrefix}Orden de prueba E2E - Run ${TEST_RUN_ID}`,
    shipping_address: `Direccion de envio E2E - ${uniqueId()}`,
    ...overrides
  }),

  /**
   * Generate a simple order item
   */
  orderItem: (
    productId: string,
    quantity: number = 1,
    price: number = 50000
  ): OrderItem => ({
    product_id: productId,
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
  name: string;
  phone?: string;
  email?: string;
  is_active?: boolean;
  notes?: string;
}

export interface OrderItem {
  product_id: string;
  quantity: number;
  price: number;
}

export interface OrderData {
  customer_id: string;
  carrier_id: string;
  items: OrderItem[];
  payment_method?: string;
  notes?: string;
  shipping_address?: string;
  total_price?: number;
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

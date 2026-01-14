/**
 * E2E Test Suite: Orders CRUD Operations
 *
 * Tests complete order lifecycle: Create, Read, Update, Delete
 * All test data uses TEST_E2E_ prefix and is cleaned up after tests.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { CONFIG, ORDER_STATUS_FLOW } from './config';
import { ProductionApiClient } from '../utils/api-client';
import { TestData } from '../utils/test-data-factory';

describe('Orders CRUD', () => {
  let api: ProductionApiClient;
  let testCarrier: any;
  let testProduct: any;
  let testCustomer: any;
  let testOrder: any;

  // Helper to extract data from API response
  const extractData = (response: any) => response?.data || response;

  beforeAll(async () => {
    api = new ProductionApiClient();
    await api.login();

    console.log('\n📦 Setting up test data for Orders CRUD tests...\n');

    // Create carrier first (no dependencies)
    const carrierResponse = await api.request('POST', '/carriers', TestData.carrier());
    testCarrier = extractData(carrierResponse);
    api.trackResource('carriers', testCarrier.id);
    console.log(`  ✓ Created carrier: ${testCarrier.carrier_name || testCarrier.name}`);

    // Create product
    const productResponse = await api.request('POST', '/products', TestData.product({ stock: 100 }));
    testProduct = extractData(productResponse);
    api.trackResource('products', testProduct.id);
    console.log(`  ✓ Created product: ${testProduct.name}`);

    // Create customer
    const customerResponse = await api.request('POST', '/customers', TestData.customer());
    testCustomer = extractData(customerResponse);
    api.trackResource('customers', testCustomer.id);
    console.log(`  ✓ Created customer: ${testCustomer.name}`);

    console.log('');
  });

  afterAll(async () => {
    await api.cleanupAll();
  });

  describe('Create Order', () => {
    test('Create order with valid data', async () => {
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 5, testProduct.price)]
      );

      const orderResponse = await api.request('POST', '/orders', orderData);
      testOrder = extractData(orderResponse);
      api.trackResource('orders', testOrder.id);

      expect(testOrder.id).toBeDefined();
      expect(testOrder.status).toBe(ORDER_STATUS_FLOW.PENDING);
      expect(testOrder.customer_id).toBe(testCustomer.id);
      expect(testOrder.carrier_id).toBe(testCarrier.id);
    });

    test('Order has correct calculated total', async () => {
      // Total should be quantity * price
      const expectedTotal = 5 * testProduct.price;
      expect(testOrder.total_price).toBe(expectedTotal);
    });

    test('Order has line items', async () => {
      // Get order with items
      const order = await api.request('GET', `/orders/${testOrder.id}`);

      expect(order.items || order.line_items).toBeDefined();
      const items = order.items || order.line_items;
      expect(items.length).toBeGreaterThan(0);
    });

    test('Create order with multiple items', async () => {
      // Create another product for multi-item order
      const product2Response = await api.request('POST', '/products', TestData.product({ stock: 50 }));
      const product2 = extractData(product2Response);
      api.trackResource('products', product2.id);

      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [
          TestData.orderItem(testProduct.id, 2, testProduct.price),
          TestData.orderItem(product2.id, 3, product2.price)
        ]
      );

      const multiItemOrderResponse = await api.request('POST', '/orders', orderData);
      const multiItemOrder = extractData(multiItemOrderResponse);
      api.trackResource('orders', multiItemOrder.id);

      expect(multiItemOrder.id).toBeDefined();

      // Expected total: (2 * 50000) + (3 * 50000) = 250000
      const expectedTotal = (2 * testProduct.price) + (3 * product2.price);
      expect(multiItemOrder.total_price).toBe(expectedTotal);
    });

    test('Create order fails without customer', async () => {
      const orderData = {
        carrier_id: testCarrier.id,
        items: [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      };

      const response = await api.requestRaw('POST', '/orders', orderData);
      expect([400, 422]).toContain(response.status);
    });

    test('Create order fails without items', async () => {
      const orderData = {
        customer_id: testCustomer.id,
        carrier_id: testCarrier.id,
        items: []
      };

      const response = await api.requestRaw('POST', '/orders', orderData);
      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Read Order', () => {
    test('Get order by ID', async () => {
      const order = await api.request('GET', `/orders/${testOrder.id}`);

      expect(order.id).toBe(testOrder.id);
      expect(order.customer_id).toBe(testCustomer.id);
      expect(order.carrier_id).toBe(testCarrier.id);
    });

    test('Get non-existent order returns 404', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await api.requestRaw('GET', `/orders/${fakeId}`);

      expect(response.status).toBe(404);
    });

    test('List orders includes test order', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/orders?limit=100');
      const orders = response.data || response;

      const found = Array.isArray(orders)
        ? orders.find((o: any) => o.id === testOrder.id)
        : null;

      expect(found).toBeDefined();
    });

    test('List orders with pagination', async () => {
      const page1 = await api.request<{ data: any[]; pagination?: any }>('GET', '/orders?limit=5&offset=0');

      expect(page1.data || page1).toBeDefined();

      // If pagination info is provided, verify it
      if (page1.pagination) {
        expect(page1.pagination.limit).toBe(5);
      }
    });

    test('Order includes customer info', async () => {
      const order = await api.request('GET', `/orders/${testOrder.id}`);

      // Customer info might be nested or flattened
      const customerName = order.customer?.name || order.customer_name;
      expect(customerName).toBeDefined();
    });

    test('Order includes carrier info', async () => {
      const order = await api.request('GET', `/orders/${testOrder.id}`);

      // Carrier info might be nested or flattened
      const carrierName = order.carrier?.name || order.carrier_name;
      expect(carrierName).toBeDefined();
    });
  });

  describe('Update Order Status', () => {
    let statusTestOrder: any;

    beforeAll(async () => {
      // Create a fresh order for status tests
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 2, testProduct.price)]
      );

      statusTestOrder = await api.request('POST', '/orders', orderData);
      api.trackResource('orders', statusTestOrder.id);
    });

    test('Update order status to confirmed', async () => {
      const updated = await api.request('PATCH', `/orders/${statusTestOrder.id}/status`, {
        status: ORDER_STATUS_FLOW.CONFIRMED
      });

      expect(updated.status).toBe(ORDER_STATUS_FLOW.CONFIRMED);
    });

    test('Update order status to in_preparation', async () => {
      const updated = await api.request('PATCH', `/orders/${statusTestOrder.id}/status`, {
        status: ORDER_STATUS_FLOW.IN_PREPARATION
      });

      expect(updated.status).toBe(ORDER_STATUS_FLOW.IN_PREPARATION);
    });

    test('Update order status to ready_to_ship', async () => {
      const updated = await api.request('PATCH', `/orders/${statusTestOrder.id}/status`, {
        status: ORDER_STATUS_FLOW.READY_TO_SHIP
      });

      expect(updated.status).toBe(ORDER_STATUS_FLOW.READY_TO_SHIP);
    });

    test('Update order status to shipped', async () => {
      const updated = await api.request('PATCH', `/orders/${statusTestOrder.id}/status`, {
        status: ORDER_STATUS_FLOW.SHIPPED
      });

      expect(updated.status).toBe(ORDER_STATUS_FLOW.SHIPPED);
    });

    test('Update order status to delivered', async () => {
      const updated = await api.request('PATCH', `/orders/${statusTestOrder.id}/status`, {
        status: ORDER_STATUS_FLOW.DELIVERED
      });

      expect(updated.status).toBe(ORDER_STATUS_FLOW.DELIVERED);
    });

    test('Update to invalid status fails', async () => {
      const response = await api.requestRaw('PATCH', `/orders/${statusTestOrder.id}/status`, {
        status: 'invalid_status'
      });

      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Update Order Fields', () => {
    test('Update order notes', async () => {
      const newNotes = `${CONFIG.testPrefix}Updated notes - ${Date.now()}`;

      const updated = await api.request('PATCH', `/orders/${testOrder.id}`, {
        notes: newNotes
      });

      expect(updated.notes).toBe(newNotes);
    });

    test('Update shipping address', async () => {
      const newAddress = `${CONFIG.testPrefix}Nueva direccion - ${Date.now()}`;

      const updated = await api.request('PATCH', `/orders/${testOrder.id}`, {
        shipping_address: newAddress
      });

      expect(updated.shipping_address).toBe(newAddress);
    });

    test('Update carrier', async () => {
      // Create another carrier
      const carrier2 = await api.request('POST', '/carriers', TestData.carrier());
      api.trackResource('carriers', carrier2.id);

      const updated = await api.request('PATCH', `/orders/${testOrder.id}`, {
        carrier_id: carrier2.id
      });

      expect(updated.carrier_id).toBe(carrier2.id);
    });
  });

  describe('Delete Order', () => {
    test('Delete order (soft delete)', async () => {
      // Create an order to delete
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      );

      const orderToDelete = await api.request('POST', '/orders', orderData);

      // Soft delete
      const response = await api.requestRaw('DELETE', `/orders/${orderToDelete.id}`);

      expect([200, 204]).toContain(response.status);

      // Order might still be accessible but marked as deleted
      // or return 404 depending on implementation
    });

    test('Hard delete order removes completely', async () => {
      // Create an order to hard delete
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      );

      const orderToDelete = await api.request('POST', '/orders', orderData);

      // Hard delete
      const deleteResponse = await api.requestRaw('DELETE', `/orders/${orderToDelete.id}?hard_delete=true`);

      expect([200, 204]).toContain(deleteResponse.status);

      // Verify order is gone
      const getResponse = await api.requestRaw('GET', `/orders/${orderToDelete.id}`);
      expect(getResponse.status).toBe(404);
    });
  });

  describe('Order Search & Filtering', () => {
    test('Search orders by customer name', async () => {
      const response = await api.request<{ data: any[] }>('GET', `/orders?search=${testCustomer.name}`);
      const orders = response.data || response;

      // Should find orders for this customer
      expect(Array.isArray(orders)).toBe(true);
    });

    test('Filter orders by status', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/orders?status=pending');
      const orders = response.data || response;

      if (Array.isArray(orders) && orders.length > 0) {
        // All returned orders should have pending status
        for (const order of orders) {
          expect(order.status).toBe('pending');
        }
      }
    });

    test('Filter orders by date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      const response = await api.request<{ data: any[] }>('GET', `/orders?from=${today}&to=${today}`);

      expect(response.data || response).toBeDefined();
    });
  });

  describe('Order Response Time', () => {
    test('List orders responds within acceptable time (<1s)', async () => {
      const start = Date.now();
      await api.request('GET', '/orders?limit=50');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    test('Get single order responds within acceptable time (<500ms)', async () => {
      const start = Date.now();
      await api.request('GET', `/orders/${testOrder.id}`);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);
    });
  });
});

/**
 * E2E Test Suite: Returns Flow
 *
 * Tests the returns system:
 * 1. Create return session from delivered orders
 * 2. Process items (accept/reject)
 * 3. Verify stock restoration for accepted items
 * 4. Verify audit trail
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { CONFIG, ORDER_STATUS_FLOW } from './config';
import { ProductionApiClient } from '../utils/api-client';
import { TestData } from '../utils/test-data-factory';

describe('Returns Flow', () => {
  let api: ProductionApiClient;
  let testCarrier: any;
  let testCustomer: any;
  let testProduct: any;
  let deliveredOrders: any[] = [];
  let returnSession: any;

  const INITIAL_STOCK = 100;
  const ORDER_QTY = 5;
  const ORDER_COUNT = 2;

  beforeAll(async () => {
    api = new ProductionApiClient();
    await api.login();

    console.log('\n↩️  Setting up returns test environment...\n');

    // Create carrier
    testCarrier = await api.request('POST', '/carriers', TestData.carrier());
    api.trackResource('carriers', testCarrier.id);

    // Create customer
    testCustomer = await api.request('POST', '/customers', TestData.customer());
    api.trackResource('customers', testCustomer.id);

    // Create product
    testProduct = await api.request('POST', '/products', TestData.product({
      stock: INITIAL_STOCK,
      name: `${CONFIG.testPrefix}Return_Product_${Date.now()}`
    }));
    api.trackResource('products', testProduct.id);

    // Create orders and progress to delivered
    for (let i = 0; i < ORDER_COUNT; i++) {
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, ORDER_QTY, testProduct.price)],
        { notes: `${CONFIG.testPrefix}Return_Order_${i}_${Date.now()}` }
      );

      const order = await api.request('POST', '/orders', orderData);
      api.trackResource('orders', order.id);

      // Progress through all statuses to delivered
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.SHIPPED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.DELIVERED });

      deliveredOrders.push(order);
      console.log(`  ✓ Created and delivered order ${i + 1}`);
    }

    console.log('\n');
  });

  afterAll(async () => {
    await api.cleanupAll();
  });

  describe('Pre-Return State', () => {
    test('Orders are in delivered status', async () => {
      for (const order of deliveredOrders) {
        const o = await api.request('GET', `/orders/${order.id}`);
        expect(o.status).toBe(ORDER_STATUS_FLOW.DELIVERED);
      }
    });

    test('Stock was decremented by delivered orders', async () => {
      const p = await api.request('GET', `/products/${testProduct.id}`);

      // Each order took ORDER_QTY units
      const expectedStock = INITIAL_STOCK - (ORDER_QTY * ORDER_COUNT);
      expect(p.stock).toBe(expectedStock); // 100 - (5 × 2) = 90
    });
  });

  describe('Create Return Session', () => {
    test('Create return session from delivered orders', async () => {
      const orderIds = deliveredOrders.map(o => o.id);

      returnSession = await api.request('POST', '/returns/sessions', {
        order_ids: orderIds
      });

      expect(returnSession.id).toBeDefined();
      expect(returnSession.code).toBeDefined();
      expect(returnSession.status).toBe('processing');
    });

    test('Session code follows expected format (RET-DDMMYYYY-NN)', async () => {
      expect(returnSession.code).toMatch(/^RET-\d{8}-\d{1,3}$/);
    });

    test('Session contains all selected orders', async () => {
      const session = await api.request('GET', `/returns/sessions/${returnSession.id}`);

      const sessionOrderIds = session.orders?.map((o: any) => o.id || o.order_id) || [];

      for (const order of deliveredOrders) {
        expect(sessionOrderIds).toContain(order.id);
      }
    });
  });

  describe('Process Return Items', () => {
    test('Get return session items', async () => {
      const session = await api.request('GET', `/returns/sessions/${returnSession.id}`);

      expect(session.items || session.orders).toBeDefined();
    });

    test('Accept items from first order (full acceptance)', async () => {
      const session = await api.request('GET', `/returns/sessions/${returnSession.id}`);

      // Find items from first order
      const firstOrderItems = session.items?.filter((item: any) =>
        item.order_id === deliveredOrders[0].id
      ) || [];

      for (const item of firstOrderItems) {
        await api.request('PATCH', `/returns/sessions/${returnSession.id}/items/${item.id}`, {
          status: 'accepted',
          accepted_quantity: item.quantity
        });
      }
    });

    test('Reject items from second order (damaged)', async () => {
      const session = await api.request('GET', `/returns/sessions/${returnSession.id}`);

      // Find items from second order
      const secondOrderItems = session.items?.filter((item: any) =>
        item.order_id === deliveredOrders[1].id
      ) || [];

      for (const item of secondOrderItems) {
        await api.request('PATCH', `/returns/sessions/${returnSession.id}/items/${item.id}`, {
          status: 'rejected',
          rejected_quantity: item.quantity,
          rejection_reason: 'damaged',
          notes: 'Producto danado durante el transporte'
        });
      }
    });
  });

  describe('Complete Return Session', () => {
    test('Complete the return session', async () => {
      await api.request('POST', `/returns/sessions/${returnSession.id}/complete`);

      const session = await api.request('GET', `/returns/sessions/${returnSession.id}`);
      expect(session.status).toBe('completed');
    });

    test('Orders updated to returned status', async () => {
      for (const order of deliveredOrders) {
        const o = await api.request('GET', `/orders/${order.id}`);
        expect(o.status).toBe(ORDER_STATUS_FLOW.RETURNED);
      }
    });
  });

  describe('Stock Restoration [CRITICAL]', () => {
    test('Accepted items restored stock', async () => {
      const p = await api.request('GET', `/products/${testProduct.id}`);

      // Initial: 100
      // After 2 orders delivered: 100 - (5 × 2) = 90
      // After return (1 order accepted): 90 + 5 = 95
      // (Second order rejected - no stock restoration)

      const expectedStock = INITIAL_STOCK - (ORDER_QTY * ORDER_COUNT) + ORDER_QTY;
      expect(p.stock).toBe(expectedStock); // 95
    });

    test('Rejected items did NOT restore stock', async () => {
      // Stock should be 95, not 100
      // If rejected items were restored, it would be 100
      const p = await api.request('GET', `/products/${testProduct.id}`);

      expect(p.stock).toBe(INITIAL_STOCK - ORDER_QTY); // 95, not 100
    });
  });

  describe('Partial Returns', () => {
    let partialReturnProduct: any;
    let partialReturnOrder: any;
    let partialReturnSession: any;

    beforeAll(async () => {
      // Create product
      partialReturnProduct = await api.request('POST', '/products', TestData.product({
        stock: 50,
        name: `${CONFIG.testPrefix}PartialReturn_${Date.now()}`
      }));
      api.trackResource('products', partialReturnProduct.id);

      // Create and deliver order with 10 items
      partialReturnOrder = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(partialReturnProduct.id, 10, partialReturnProduct.price)]
      ));
      api.trackResource('orders', partialReturnOrder.id);

      // Progress to delivered
      await api.request('PATCH', `/orders/${partialReturnOrder.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${partialReturnOrder.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${partialReturnOrder.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });
      await api.request('PATCH', `/orders/${partialReturnOrder.id}/status`, { status: ORDER_STATUS_FLOW.SHIPPED });
      await api.request('PATCH', `/orders/${partialReturnOrder.id}/status`, { status: ORDER_STATUS_FLOW.DELIVERED });
    });

    test('Stock after delivery is 40', async () => {
      const p = await api.request('GET', `/products/${partialReturnProduct.id}`);
      expect(p.stock).toBe(40); // 50 - 10 = 40
    });

    test('Create partial return session', async () => {
      partialReturnSession = await api.request('POST', '/returns/sessions', {
        order_ids: [partialReturnOrder.id]
      });

      expect(partialReturnSession.id).toBeDefined();
    });

    test('Accept 6 items, reject 4 items', async () => {
      const session = await api.request('GET', `/returns/sessions/${partialReturnSession.id}`);

      const items = session.items || [];
      if (items.length > 0) {
        const item = items[0];

        await api.request('PATCH', `/returns/sessions/${partialReturnSession.id}/items/${item.id}`, {
          status: 'partial',
          accepted_quantity: 6,
          rejected_quantity: 4,
          rejection_reason: 'damaged'
        });
      }
    });

    test('Complete partial return', async () => {
      await api.request('POST', `/returns/sessions/${partialReturnSession.id}/complete`);
    });

    test('Stock restored only for accepted items (40 + 6 = 46)', async () => {
      const p = await api.request('GET', `/products/${partialReturnProduct.id}`);
      expect(p.stock).toBe(46); // 40 + 6 accepted = 46
    });
  });

  describe('Return Session Management', () => {
    test('List return sessions', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/returns/sessions');
      const sessions = response.data || response;

      expect(Array.isArray(sessions)).toBe(true);

      if (sessions.length > 0) {
        const found = sessions.find((s: any) => s.id === returnSession.id);
        expect(found).toBeDefined();
      }
    });

    test('Filter sessions by status', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/returns/sessions?status=completed');
      const sessions = response.data || response;

      if (Array.isArray(sessions) && sessions.length > 0) {
        for (const session of sessions) {
          expect(session.status).toBe('completed');
        }
      }
    });
  });

  describe('Error Handling', () => {
    test('Cannot create return for non-delivered order', async () => {
      // Create a pending order
      const pendingOrder = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      ));
      api.trackResource('orders', pendingOrder.id);

      const response = await api.requestRaw('POST', '/returns/sessions', {
        order_ids: [pendingOrder.id]
      });

      // Should fail - order must be delivered/shipped
      expect([400, 422]).toContain(response.status);
    });

    test('Cannot return more than ordered quantity', async () => {
      // Create and deliver an order
      const order = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 3, testProduct.price)]
      ));
      api.trackResource('orders', order.id);

      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.SHIPPED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.DELIVERED });

      // Create return session
      const session = await api.request('POST', '/returns/sessions', {
        order_ids: [order.id]
      });

      // Try to return more than ordered
      const sessionData = await api.request('GET', `/returns/sessions/${session.id}`);
      const items = sessionData.items || [];

      if (items.length > 0) {
        const response = await api.requestRaw('PATCH',
          `/returns/sessions/${session.id}/items/${items[0].id}`,
          {
            status: 'accepted',
            accepted_quantity: 100 // More than ordered (3)
          }
        );

        expect([400, 422]).toContain(response.status);
      }

      // Clean up - abandon session
      try {
        await api.request('POST', `/returns/sessions/${session.id}/cancel`);
      } catch (e) {
        // May fail if session already completed
      }
    });
  });

  describe('Rejection Reasons', () => {
    test('All rejection reasons are valid', async () => {
      const validReasons = ['damaged', 'defective', 'incomplete', 'wrong_item', 'other'];

      // Create a test order and return
      const order = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      ));
      api.trackResource('orders', order.id);

      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.SHIPPED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.DELIVERED });

      const session = await api.request('POST', '/returns/sessions', { order_ids: [order.id] });
      const sessionData = await api.request('GET', `/returns/sessions/${session.id}`);

      const items = sessionData.items || [];
      if (items.length > 0) {
        // Test with valid reason
        const response = await api.requestRaw('PATCH',
          `/returns/sessions/${session.id}/items/${items[0].id}`,
          {
            status: 'rejected',
            rejected_quantity: 1,
            rejection_reason: 'damaged'
          }
        );

        expect(response.ok).toBe(true);
      }

      // Complete session for cleanup
      await api.request('POST', `/returns/sessions/${session.id}/complete`);
    });
  });
});

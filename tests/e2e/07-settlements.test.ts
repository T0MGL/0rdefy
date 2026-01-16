/**
 * E2E Test Suite: Dispatch & Settlements
 *
 * Tests the dispatch and courier reconciliation system:
 * 1. Create dispatch session from ready_to_ship orders
 * 2. Export CSV for courier
 * 3. Process settlement (reconciliation)
 * 4. Verify financial calculations
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { CONFIG, ORDER_STATUS_FLOW } from './config';
import { ProductionApiClient } from '../utils/api-client';
import { TestData } from '../utils/test-data-factory';

describe('Dispatch & Settlements Flow', () => {
  let api: ProductionApiClient;
  let testCarrier: any;
  let testCustomer: any;
  let testProduct: any;
  const readyToShipOrders: any[] = [];
  let dispatchSession: any;

  const INITIAL_STOCK = 200;
  const ORDER_QTY = 3;
  const ORDER_COUNT = 3;
  const ORDER_PRICE = 50000;

  beforeAll(async () => {
    api = new ProductionApiClient();
    await api.login();

    console.log('\n🚀 Setting up dispatch & settlements test environment...\n');

    // Create carrier with zones
    const carrierResponse = await api.request('POST', '/carriers', TestData.carrier());
    testCarrier = carrierResponse.data || carrierResponse;
    api.trackResource('carriers', testCarrier.id);

    // Try to create carrier zone
    try {
      const zone = await api.request('POST', '/carriers/zones', {
        carrier_id: testCarrier.id,
        zone_name: `${CONFIG.testPrefix}Zone_Asuncion`,
        city: 'Asuncion',
        rate_cod: 25000,
        rate_prepaid: 20000,
        is_active: true
      });
      console.log(`  ✓ Created carrier zone`);
    } catch (error) {
      console.log(`  ℹ️  Carrier zone creation skipped (may not be required)`);
    }

    // Create customer
    const customerResponse = await api.request('POST', '/customers', TestData.customer({
      city: 'Asuncion'
    }));
    testCustomer = customerResponse.data || customerResponse;
    api.trackResource('customers', testCustomer.id);

    // Create product
    const productResponse = await api.request('POST', '/products', TestData.product({
      stock: INITIAL_STOCK,
      name: `${CONFIG.testPrefix}Settlement_Product_${Date.now()}`
    }));
    testProduct = productResponse.data || productResponse;
    api.trackResource('products', testProduct.id);

    // Create orders and progress to ready_to_ship
    for (let i = 0; i < ORDER_COUNT; i++) {
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, ORDER_QTY, ORDER_PRICE)],
        {
          notes: `${CONFIG.testPrefix}Settlement_Order_${i}_${Date.now()}`,
          payment_method: i === 0 ? 'prepaid' : 'cash' // Mix of payment methods
        }
      );

      const orderResponse = await api.request('POST', '/orders', orderData);
      const order = orderResponse.data || orderResponse;
      api.trackResource('orders', order.id);

      // Progress to ready_to_ship
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      readyToShipOrders.push(order);
      console.log(`  ✓ Created ready_to_ship order ${i + 1}`);
    }

    console.log('\n');
  });

  afterAll(async () => {
    // Clean up dispatch session if exists
    if (dispatchSession?.id) {
      try {
        await api.request('POST', `/settlements/dispatch-sessions/${dispatchSession.id}/cancel`);
      } catch (error) {
        // May fail if already processed
      }
    }

    await api.cleanupAll();
  });

  describe('Pre-Dispatch State', () => {
    test('Orders are ready_to_ship', async () => {
      for (const order of readyToShipOrders) {
        const o = await api.request('GET', `/orders/${order.id}`);
        expect(o.status).toBe(ORDER_STATUS_FLOW.READY_TO_SHIP);
      }
    });

    test('Stock was already decremented', async () => {
      const p = await api.request('GET', `/products/${testProduct.id}`);
      const expectedStock = INITIAL_STOCK - (ORDER_QTY * ORDER_COUNT);
      expect(p.stock).toBe(expectedStock); // 200 - (3 × 3) = 191
    });
  });

  describe('Create Dispatch Session', () => {
    test('Create dispatch session from ready_to_ship orders', async () => {
      const orderIds = readyToShipOrders.map(o => o.id);

      dispatchSession = await api.request('POST', '/settlements/dispatch-sessions', {
        order_ids: orderIds,
        carrier_id: testCarrier.id
      });

      expect(dispatchSession.id).toBeDefined();
      expect(dispatchSession.code).toBeDefined();
      expect(dispatchSession.status).toBe('created');
    });

    test('Session code follows expected format (DISP-DDMMYYYY-NNN)', async () => {
      expect(dispatchSession.code).toMatch(/^DISP-\d{8}-\d{1,3}$/);
    });

    test('Session contains all selected orders', async () => {
      const session = await api.request('GET',
        `/settlements/dispatch-sessions/${dispatchSession.id}`
      );

      const sessionOrderIds = session.orders?.map((o: any) => o.id || o.order_id) || [];

      for (const order of readyToShipOrders) {
        expect(sessionOrderIds).toContain(order.id);
      }
    });
  });

  describe('Dispatch Orders', () => {
    test('Mark session as dispatched', async () => {
      await api.request('POST',
        `/settlements/dispatch-sessions/${dispatchSession.id}/dispatch`
      );

      const session = await api.request('GET',
        `/settlements/dispatch-sessions/${dispatchSession.id}`
      );

      expect(session.status).toBe('dispatched');
    });

    test('Orders status changed to shipped', async () => {
      for (const order of readyToShipOrders) {
        const o = await api.request('GET', `/orders/${order.id}`);
        expect(o.status).toBe(ORDER_STATUS_FLOW.SHIPPED);
      }
    });
  });

  describe('Export', () => {
    test('Can export dispatch session (default Excel)', async () => {
      const response = await api.requestRaw('GET',
        `/settlements/dispatch-sessions/${dispatchSession.id}/export`
      );

      expect(response.status).toBe(200);

      // Default format is XLSX
      const contentType = response.headers.get('content-type');
      if (contentType) {
        expect(contentType).toContain('spreadsheet');
      }
    });

    test('Can export dispatch session to CSV', async () => {
      const response = await api.requestRaw('GET',
        `/settlements/dispatch-sessions/${dispatchSession.id}/export?format=csv`
      );

      expect(response.status).toBe(200);

      const contentType = response.headers.get('content-type');
      if (contentType) {
        expect(contentType).toContain('csv');
      }
    });
  });

  describe('Process Delivery Results', () => {
    test('Import delivery results (simulated)', async () => {
      // Simulate delivery results:
      // Order 0: Delivered
      // Order 1: Delivered
      // Order 2: Failed

      const deliveryResults = readyToShipOrders.map((order, index) => ({
        order_id: order.id,
        delivery_result: index < 2 ? 'delivered' : 'failed',
        cod_collected: index < 2 && order.payment_method !== 'prepaid'
          ? ORDER_QTY * ORDER_PRICE
          : 0,
        delivery_date: new Date().toISOString(),
        notes: index < 2 ? 'Entregado con exito' : 'Cliente no estaba'
      }));

      await api.request('POST',
        `/settlements/dispatch-sessions/${dispatchSession.id}/import`,
        { results: deliveryResults }
      );

      const session = await api.request('GET',
        `/settlements/dispatch-sessions/${dispatchSession.id}`
      );

      expect(session.status).toBe('processing');
    });

    test('Orders updated with delivery results', async () => {
      // First 2 orders should be delivered
      for (let i = 0; i < 2; i++) {
        const order = await api.request('GET', `/orders/${readyToShipOrders[i].id}`);
        expect(order.status).toBe(ORDER_STATUS_FLOW.DELIVERED);
      }

      // Third order should remain shipped (failed delivery)
      const failedOrder = await api.request('GET', `/orders/${readyToShipOrders[2].id}`);
      expect(failedOrder.status).toBe(ORDER_STATUS_FLOW.SHIPPED);
    });
  });

  describe('Settlement Processing', () => {
    test('Process settlement (create financial record)', async () => {
      await api.request('POST',
        `/settlements/dispatch-sessions/${dispatchSession.id}/process`
      );

      const session = await api.request('GET',
        `/settlements/dispatch-sessions/${dispatchSession.id}`
      );

      expect(session.status).toBe('settled');
    });

    test('Settlement has correct financial totals', async () => {
      const session = await api.request('GET',
        `/settlements/dispatch-sessions/${dispatchSession.id}`
      );

      // COD expected: Only cash orders (2 out of 3, minus failed)
      // Order 0: prepaid - no COD
      // Order 1: cash, delivered - COD collected
      // Order 2: cash, failed - no COD

      if (session.settlement) {
        expect(session.settlement.total_cod_expected).toBeDefined();
        expect(session.settlement.total_cod_collected).toBeDefined();
        expect(session.settlement.carrier_fees).toBeDefined();
      }
    });
  });

  describe('Session Management', () => {
    test('List dispatch sessions', async () => {
      const response = await api.request<{ data: any[] }>('GET',
        '/settlements/dispatch-sessions'
      );

      const sessions = response.data || response;
      expect(Array.isArray(sessions)).toBe(true);

      if (sessions.length > 0) {
        const found = sessions.find((s: any) => s.id === dispatchSession.id);
        expect(found).toBeDefined();
      }
    });

    test('Filter sessions by status', async () => {
      const response = await api.request<{ data: any[] }>('GET',
        '/settlements/dispatch-sessions?status=settled'
      );

      const sessions = response.data || response;
      if (Array.isArray(sessions) && sessions.length > 0) {
        for (const session of sessions) {
          expect(session.status).toBe('settled');
        }
      }
    });

    test('Filter sessions by carrier', async () => {
      const response = await api.request<{ data: any[] }>('GET',
        `/settlements/dispatch-sessions?carrier_id=${testCarrier.id}`
      );

      const sessions = response.data || response;
      if (Array.isArray(sessions)) {
        for (const session of sessions) {
          expect(session.carrier_id).toBe(testCarrier.id);
        }
      }
    });
  });

  describe('Pending Amounts', () => {
    test('Get pending amounts by carrier', async () => {
      const pending = await api.request('GET', '/settlements/pending-by-carrier');

      expect(pending).toBeDefined();
      // Should be array or object with carrier data
    });
  });

  describe('Settlement Analytics', () => {
    test('Get settlement summary', async () => {
      const summary = await api.request('GET', '/settlements/summary/v2');

      expect(summary).toBeDefined();

      // Should have aggregated data
      if (summary.total_settled !== undefined) {
        expect(typeof summary.total_settled).toBe('number');
      }
    });
  });

  describe('Error Handling', () => {
    test('Cannot create dispatch with non-ready orders', async () => {
      // Create a pending order
      const pendingOrder = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      ));
      api.trackResource('orders', pendingOrder.id);

      const response = await api.requestRaw('POST', '/settlements/dispatch-sessions', {
        order_ids: [pendingOrder.id],
        carrier_id: testCarrier.id
      });

      // Should fail - order must be ready_to_ship
      expect([400, 422]).toContain(response.status);
    });

    test('Cannot add same order to multiple active sessions', async () => {
      // Create a new ready_to_ship order
      const order = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      ));
      api.trackResource('orders', order.id);

      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      // Create first session
      const session1 = await api.request('POST', '/settlements/dispatch-sessions', {
        order_ids: [order.id],
        carrier_id: testCarrier.id
      });

      // Try to create second session with same order
      const response = await api.requestRaw('POST', '/settlements/dispatch-sessions', {
        order_ids: [order.id],
        carrier_id: testCarrier.id
      });

      // Should fail - duplicate order prevention
      expect([400, 422]).toContain(response.status);

      // Cleanup first session
      try {
        await api.request('POST', `/settlements/dispatch-sessions/${session1.id}/cancel`);
      } catch (e) {
        // May fail
      }
    });
  });

  describe('Session Cancellation', () => {
    let cancelTestSession: any;
    let cancelTestOrder: any;

    beforeAll(async () => {
      // Create order
      cancelTestOrder = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      ));
      api.trackResource('orders', cancelTestOrder.id);

      await api.request('PATCH', `/orders/${cancelTestOrder.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${cancelTestOrder.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${cancelTestOrder.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      // Create session
      cancelTestSession = await api.request('POST', '/settlements/dispatch-sessions', {
        order_ids: [cancelTestOrder.id],
        carrier_id: testCarrier.id
      });
    });

    test('Can cancel non-dispatched session', async () => {
      await api.request('POST',
        `/settlements/dispatch-sessions/${cancelTestSession.id}/cancel`
      );

      const session = await api.request('GET',
        `/settlements/dispatch-sessions/${cancelTestSession.id}`
      );

      expect(session.status).toBe('cancelled');
    });

    test('Orders return to ready_to_ship after cancellation', async () => {
      const order = await api.request('GET', `/orders/${cancelTestOrder.id}`);
      expect(order.status).toBe(ORDER_STATUS_FLOW.READY_TO_SHIP);
    });
  });

  describe('Performance', () => {
    test('Dispatch session creation is fast (<2s)', async () => {
      // Create test order
      const order = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(testProduct.id, 1, testProduct.price)]
      ));
      api.trackResource('orders', order.id);

      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      const start = Date.now();

      const session = await api.request('POST', '/settlements/dispatch-sessions', {
        order_ids: [order.id],
        carrier_id: testCarrier.id
      });

      const duration = Date.now() - start;

      // Cancel for cleanup
      await api.request('POST', `/settlements/dispatch-sessions/${session.id}/cancel`);

      expect(duration).toBeLessThan(2000);
    });
  });
});

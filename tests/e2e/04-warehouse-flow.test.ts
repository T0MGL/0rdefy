/**
 * E2E Test Suite: Warehouse Flow - Picking & Packing
 *
 * Tests the complete warehouse workflow:
 * 1. Create picking session from confirmed orders
 * 2. Process picking (aggregate products)
 * 3. Complete packing (split by order)
 * 4. Verify orders reach ready_to_ship and stock decrements
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { CONFIG, ORDER_STATUS_FLOW } from './config';
import { ProductionApiClient } from '../utils/api-client';
import { TestData, TestDataBatch } from '../utils/test-data-factory';

describe('Warehouse Picking & Packing Flow', () => {
  let api: ProductionApiClient;
  let testCarrier: any;
  let testCustomer: any;
  let products: any[] = [];
  let confirmedOrders: any[] = [];
  let pickingSession: any;

  const PRODUCT_COUNT = 2;
  const ORDER_COUNT = 3;
  const INITIAL_STOCK = 100;

  beforeAll(async () => {
    api = new ProductionApiClient();
    await api.login();

    console.log('\n🏭 Setting up warehouse test environment...\n');

    // Create carrier
    testCarrier = await api.request('POST', '/carriers', TestData.carrier());
    api.trackResource('carriers', testCarrier.id);

    // Create customer
    testCustomer = await api.request('POST', '/customers', TestData.customer());
    api.trackResource('customers', testCustomer.id);

    // Create products
    for (let i = 0; i < PRODUCT_COUNT; i++) {
      const product = await api.request('POST', '/products', TestData.product({
        stock: INITIAL_STOCK,
        name: `${CONFIG.testPrefix}WH_Product_${i}_${Date.now()}`
      }));
      api.trackResource('products', product.id);
      products.push(product);
      console.log(`  ✓ Created product ${i + 1}: ${product.name}`);
    }

    // Create and confirm orders
    for (let i = 0; i < ORDER_COUNT; i++) {
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [
          TestData.orderItem(products[0].id, 3, products[0].price),
          TestData.orderItem(products[1].id, 2, products[1].price)
        ],
        { notes: `${CONFIG.testPrefix}WH_Order_${i}_${Date.now()}` }
      );

      const order = await api.request('POST', '/orders', orderData);
      api.trackResource('orders', order.id);

      // Confirm the order (required for picking)
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.CONFIRMED
      });

      confirmedOrders.push(order);
      console.log(`  ✓ Created and confirmed order ${i + 1}`);
    }

    console.log('\n');
  });

  afterAll(async () => {
    // Clean up picking session if it exists
    if (pickingSession?.id) {
      try {
        // Try to abandon/cancel the session first
        await api.request('POST', `/warehouse/picking-sessions/${pickingSession.id}/abandon`);
      } catch (error) {
        // Session might be completed or already cleaned
      }
    }

    await api.cleanupAll();
  });

  describe('Create Picking Session', () => {
    test('Create picking session from confirmed orders', async () => {
      const orderIds = confirmedOrders.map(o => o.id);

      pickingSession = await api.request('POST', '/warehouse/picking-sessions', {
        order_ids: orderIds
      });

      expect(pickingSession.id).toBeDefined();
      expect(pickingSession.code).toBeDefined();
      expect(pickingSession.status).toBe('picking');
    });

    test('Session code follows expected format (PREP-DDMMYYYY-NNN)', async () => {
      // Code should match format: PREP-DDMMYYYY-001 or similar
      expect(pickingSession.code).toMatch(/^PREP-\d{8}-\d{1,3}$/);
    });

    test('Session contains all selected orders', async () => {
      const session = await api.request('GET', `/warehouse/picking-sessions/${pickingSession.id}`);

      const sessionOrderIds = session.orders?.map((o: any) => o.id || o.order_id) || [];

      for (const order of confirmedOrders) {
        expect(sessionOrderIds).toContain(order.id);
      }
    });

    test('Orders status changed to in_preparation', async () => {
      for (const order of confirmedOrders) {
        const updatedOrder = await api.request('GET', `/orders/${order.id}`);
        expect(updatedOrder.status).toBe(ORDER_STATUS_FLOW.IN_PREPARATION);
      }
    });

    test('Stock NOT decremented yet (in_preparation)', async () => {
      for (const product of products) {
        const p = await api.request('GET', `/products/${product.id}`);
        expect(p.stock).toBe(INITIAL_STOCK);
      }
    });
  });

  describe('Picking Phase', () => {
    let pickingList: any;

    test('Get picking list (aggregated products)', async () => {
      pickingList = await api.request('GET',
        `/warehouse/picking-sessions/${pickingSession.id}/picking-list`
      );

      expect(pickingList.items || pickingList).toBeDefined();
    });

    test('Picking list aggregates quantities across orders', async () => {
      const items = pickingList.items || pickingList;

      if (Array.isArray(items)) {
        // Product 0: 3 qty × 3 orders = 9 total
        // Product 1: 2 qty × 3 orders = 6 total
        const product0Item = items.find((i: any) =>
          i.product_id === products[0].id ||
          i.product?.id === products[0].id
        );
        const product1Item = items.find((i: any) =>
          i.product_id === products[1].id ||
          i.product?.id === products[1].id
        );

        if (product0Item) {
          expect(product0Item.required_quantity || product0Item.quantity).toBe(9);
        }
        if (product1Item) {
          expect(product1Item.required_quantity || product1Item.quantity).toBe(6);
        }
      }
    });

    test('Update picked quantities', async () => {
      const items = pickingList.items || pickingList;

      if (Array.isArray(items)) {
        for (const item of items) {
          const itemId = item.id;
          const requiredQty = item.required_quantity || item.quantity;

          if (itemId && requiredQty) {
            await api.request('PATCH',
              `/warehouse/picking-sessions/${pickingSession.id}/items/${itemId}`,
              { picked_quantity: requiredQty }
            );
          }
        }
      }

      // Verify all items picked
      const updatedList = await api.request('GET',
        `/warehouse/picking-sessions/${pickingSession.id}/picking-list`
      );

      const updatedItems = updatedList.items || updatedList;
      if (Array.isArray(updatedItems)) {
        for (const item of updatedItems) {
          const required = item.required_quantity || item.quantity;
          const picked = item.picked_quantity || item.picked;

          if (required && picked !== undefined) {
            expect(picked).toBe(required);
          }
        }
      }
    });

    test('Complete picking phase', async () => {
      await api.request('POST',
        `/warehouse/picking-sessions/${pickingSession.id}/complete-picking`
      );

      const session = await api.request('GET',
        `/warehouse/picking-sessions/${pickingSession.id}`
      );

      expect(session.status).toBe('packing');
    });
  });

  describe('Packing Phase', () => {
    test('Session status is packing', async () => {
      const session = await api.request('GET',
        `/warehouse/picking-sessions/${pickingSession.id}`
      );

      expect(session.status).toBe('packing');
    });

    test('Pack each order', async () => {
      for (const order of confirmedOrders) {
        await api.request('PATCH',
          `/warehouse/picking-sessions/${pickingSession.id}/orders/${order.id}/pack`
        );
      }
    });

    test('Complete packing session', async () => {
      await api.request('POST',
        `/warehouse/picking-sessions/${pickingSession.id}/complete`
      );

      const session = await api.request('GET',
        `/warehouse/picking-sessions/${pickingSession.id}`
      );

      expect(session.status).toBe('completed');
    });
  });

  describe('Post-Packing Verification', () => {
    test('All orders are ready_to_ship', async () => {
      for (const order of confirmedOrders) {
        const updatedOrder = await api.request('GET', `/orders/${order.id}`);
        expect(updatedOrder.status).toBe(ORDER_STATUS_FLOW.READY_TO_SHIP);
      }
    });

    test('Stock was decremented correctly [CRITICAL]', async () => {
      // Product 0: 3 qty × 3 orders = 9 decremented → 100 - 9 = 91
      // Product 1: 2 qty × 3 orders = 6 decremented → 100 - 6 = 94

      const p0 = await api.request('GET', `/products/${products[0].id}`);
      const p1 = await api.request('GET', `/products/${products[1].id}`);

      expect(p0.stock).toBe(INITIAL_STOCK - (3 * ORDER_COUNT)); // 91
      expect(p1.stock).toBe(INITIAL_STOCK - (2 * ORDER_COUNT)); // 94
    });
  });

  describe('Session Management', () => {
    test('List picking sessions includes our session', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/warehouse/picking-sessions');
      const sessions = response.data || response;

      if (Array.isArray(sessions)) {
        const found = sessions.find((s: any) => s.id === pickingSession.id);
        expect(found).toBeDefined();
      }
    });

    test('Can filter sessions by status', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/warehouse/picking-sessions?status=completed');
      const sessions = response.data || response;

      if (Array.isArray(sessions) && sessions.length > 0) {
        for (const session of sessions) {
          expect(session.status).toBe('completed');
        }
      }
    });
  });

  describe('Session Abandonment', () => {
    let abandonTestSession: any;
    let abandonTestOrders: any[] = [];

    beforeAll(async () => {
      // Create fresh orders for abandonment test
      for (let i = 0; i < 2; i++) {
        const orderData = TestData.order(
          testCustomer.id,
          testCarrier.id,
          [TestData.orderItem(products[0].id, 2, products[0].price)],
          { notes: `${CONFIG.testPrefix}Abandon_Order_${i}_${Date.now()}` }
        );

        const order = await api.request('POST', '/orders', orderData);
        api.trackResource('orders', order.id);

        await api.request('PATCH', `/orders/${order.id}/status`, {
          status: ORDER_STATUS_FLOW.CONFIRMED
        });

        abandonTestOrders.push(order);
      }

      // Create picking session
      abandonTestSession = await api.request('POST', '/warehouse/picking-sessions', {
        order_ids: abandonTestOrders.map(o => o.id)
      });
    });

    test('Can abandon picking session', async () => {
      await api.request('POST',
        `/warehouse/picking-sessions/${abandonTestSession.id}/abandon`
      );

      const session = await api.request('GET',
        `/warehouse/picking-sessions/${abandonTestSession.id}`
      );

      expect(session.status).toBe('abandoned');
    });

    test('Abandoned session orders return to confirmed', async () => {
      for (const order of abandonTestOrders) {
        const updatedOrder = await api.request('GET', `/orders/${order.id}`);
        expect(updatedOrder.status).toBe(ORDER_STATUS_FLOW.CONFIRMED);
      }
    });
  });

  describe('Error Handling', () => {
    test('Cannot create session with non-confirmed orders', async () => {
      // Create a pending order
      const pendingOrder = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(products[0].id, 1, products[0].price)]
      ));
      api.trackResource('orders', pendingOrder.id);

      const response = await api.requestRaw('POST', '/warehouse/picking-sessions', {
        order_ids: [pendingOrder.id]
      });

      // Should fail - order must be confirmed
      expect([400, 422]).toContain(response.status);
    });

    test('Cannot add order to existing session', async () => {
      // Try to add order to completed session
      const response = await api.requestRaw('POST',
        `/warehouse/picking-sessions/${pickingSession.id}/orders`,
        { order_id: confirmedOrders[0].id }
      );

      // Should fail - session is completed
      expect([400, 404, 422]).toContain(response.status);
    });
  });

  describe('Performance', () => {
    test('Creating picking session is fast (<2s)', async () => {
      // Create test orders
      const testOrders: any[] = [];
      for (let i = 0; i < 2; i++) {
        const order = await api.request('POST', '/orders', TestData.order(
          testCustomer.id,
          testCarrier.id,
          [TestData.orderItem(products[0].id, 1, products[0].price)]
        ));
        api.trackResource('orders', order.id);
        await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
        testOrders.push(order);
      }

      const start = Date.now();

      const session = await api.request('POST', '/warehouse/picking-sessions', {
        order_ids: testOrders.map(o => o.id)
      });

      const duration = Date.now() - start;

      // Abandon for cleanup
      await api.request('POST', `/warehouse/picking-sessions/${session.id}/abandon`);

      expect(duration).toBeLessThan(2000);
    });
  });
});

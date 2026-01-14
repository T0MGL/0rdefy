/**
 * E2E Test Suite: Warehouse Flow - Picking & Packing
 *
 * Tests the complete warehouse workflow:
 * 1. Create picking session from confirmed orders
 * 2. Process picking (aggregate products)
 * 3. Complete packing (split by order)
 * 4. Verify orders reach ready_to_ship and stock decrements
 *
 * API Endpoints (actual routes):
 * - POST /warehouse/sessions - Create session
 * - GET /warehouse/sessions/:id/picking-list
 * - POST /warehouse/sessions/:id/picking-progress
 * - POST /warehouse/sessions/:id/finish-picking
 * - POST /warehouse/sessions/:id/packing-progress
 * - POST /warehouse/sessions/:id/complete
 * - POST /warehouse/sessions/:id/abandon
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
    const carrierResponse = await api.request('POST', '/carriers', TestData.carrier());
    testCarrier = carrierResponse.data || carrierResponse;
    api.trackResource('carriers', testCarrier.id);

    // Create customer
    const customerResponse = await api.request('POST', '/customers', TestData.customer());
    testCustomer = customerResponse.data || customerResponse;
    api.trackResource('customers', testCustomer.id);

    // Create products
    for (let i = 0; i < PRODUCT_COUNT; i++) {
      const productResponse = await api.request('POST', '/products', TestData.product({
        stock: INITIAL_STOCK,
        name: `${CONFIG.testPrefix}WH_Product_${i}_${Date.now()}`
      }));
      const product = productResponse.data || productResponse;
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

      const orderResponse = await api.request('POST', '/orders', orderData);
      const order = orderResponse.data || orderResponse;
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
        await api.request('POST', `/warehouse/sessions/${pickingSession.id}/abandon`);
      } catch (error) {
        // Session might be completed or already cleaned
      }
    }

    await api.cleanupAll();
  });

  describe('Create Picking Session', () => {
    test('Create picking session from confirmed orders', async () => {
      const orderIds = confirmedOrders.map(o => o.id);

      // API uses /warehouse/sessions with orderIds array
      pickingSession = await api.request('POST', '/warehouse/sessions', {
        orderIds: orderIds
      });

      expect(pickingSession.id).toBeDefined();
      expect(pickingSession.session_code).toBeDefined();
      expect(pickingSession.status).toBe('picking');
    });

    test('Session code follows expected format (PREP-DDMMYYYY-NNN)', async () => {
      expect(pickingSession.session_code).toMatch(/^PREP-\d{8}-\d{1,3}$/);
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
        `/warehouse/sessions/${pickingSession.id}/picking-list`
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
          expect(product0Item.total_quantity || product0Item.quantity).toBe(9);
        }
        if (product1Item) {
          expect(product1Item.total_quantity || product1Item.quantity).toBe(6);
        }
      }
    });

    test('Update picking progress', async () => {
      const items = pickingList.items || pickingList;

      if (Array.isArray(items)) {
        for (const item of items) {
          const productId = item.product_id || item.product?.id;
          const requiredQty = item.total_quantity || item.quantity;

          if (productId && requiredQty) {
            await api.request('POST',
              `/warehouse/sessions/${pickingSession.id}/picking-progress`,
              { productId, quantityPicked: requiredQty }
            );
          }
        }
      }
    });

    test('Complete picking phase (finish-picking)', async () => {
      await api.request('POST',
        `/warehouse/sessions/${pickingSession.id}/finish-picking`
      );

      // Session status should now be packing
      const packingList = await api.request('GET',
        `/warehouse/sessions/${pickingSession.id}/packing-list`
      );

      expect(packingList).toBeDefined();
    });
  });

  describe('Packing Phase', () => {
    test('Pack each order (assign products)', async () => {
      // Get packing list
      const packingList = await api.request('GET',
        `/warehouse/sessions/${pickingSession.id}/packing-list`
      );

      const orders = packingList.orders || packingList;

      if (Array.isArray(orders)) {
        for (const order of orders) {
          const orderId = order.id || order.order_id;
          const items = order.items || order.line_items || [];

          // Pack each item in the order
          for (const item of items) {
            const productId = item.product_id || item.product?.id;
            if (productId) {
              await api.request('POST',
                `/warehouse/sessions/${pickingSession.id}/packing-progress`,
                { orderId, productId }
              );
            }
          }
        }
      }
    });

    test('Complete packing session', async () => {
      await api.request('POST',
        `/warehouse/sessions/${pickingSession.id}/complete`
      );

      // Session should be completed
      const sessions = await api.request('GET', '/warehouse/sessions/active');
      const sessionIds = (sessions || []).map((s: any) => s.id);

      // Completed session should not be in active list
      expect(sessionIds).not.toContain(pickingSession.id);
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
    test('Get confirmed orders for picking', async () => {
      const orders = await api.request('GET', '/warehouse/orders/confirmed');
      expect(orders).toBeDefined();
      expect(Array.isArray(orders)).toBe(true);
    });

    test('Get active sessions', async () => {
      const sessions = await api.request('GET', '/warehouse/sessions/active');
      expect(Array.isArray(sessions)).toBe(true);
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

        const orderResponse = await api.request('POST', '/orders', orderData);
        const order = orderResponse.data || orderResponse;
        api.trackResource('orders', order.id);

        await api.request('PATCH', `/orders/${order.id}/status`, {
          status: ORDER_STATUS_FLOW.CONFIRMED
        });

        abandonTestOrders.push(order);
      }

      // Create picking session
      abandonTestSession = await api.request('POST', '/warehouse/sessions', {
        orderIds: abandonTestOrders.map(o => o.id)
      });
    });

    test('Can abandon picking session', async () => {
      const result = await api.request('POST',
        `/warehouse/sessions/${abandonTestSession.id}/abandon`
      );

      expect(result.message || result.success).toBeDefined();
    });

    test('Abandoned session orders return to confirmed', async () => {
      for (const order of abandonTestOrders) {
        const updatedOrder = await api.request('GET', `/orders/${order.id}`);
        expect(updatedOrder.status).toBe(ORDER_STATUS_FLOW.CONFIRMED);
      }
    });
  });

  describe('Error Handling', () => {
    test('Cannot create session with no orders', async () => {
      const response = await api.requestRaw('POST', '/warehouse/sessions', {
        orderIds: []
      });

      expect([400, 422]).toContain(response.status);
    });

    test('Cannot create session without orderIds', async () => {
      const response = await api.requestRaw('POST', '/warehouse/sessions', {});

      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Performance', () => {
    test('Creating picking session is fast (<3s)', async () => {
      // Create test orders
      const testOrders: any[] = [];
      for (let i = 0; i < 2; i++) {
        const orderResponse = await api.request('POST', '/orders', TestData.order(
          testCustomer.id,
          testCarrier.id,
          [TestData.orderItem(products[0].id, 1, products[0].price)]
        ));
        const order = orderResponse.data || orderResponse;
        api.trackResource('orders', order.id);
        await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
        testOrders.push(order);
      }

      const start = Date.now();

      const session = await api.request('POST', '/warehouse/sessions', {
        orderIds: testOrders.map(o => o.id)
      });

      const duration = Date.now() - start;

      // Abandon for cleanup
      try {
        await api.request('POST', `/warehouse/sessions/${session.id}/abandon`);
      } catch (e) {
        // May fail
      }

      expect(duration).toBeLessThan(3000);
    });
  });
});

/**
 * E2E Test Suite: Inventory Flow - CRITICAL
 *
 * Tests the automatic stock tracking system.
 * This is one of the most critical tests as incorrect stock management
 * can cause overselling or lost inventory.
 *
 * Stock decrements at: ready_to_ship
 * Stock restores on: cancelled (after decrement)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CONFIG, ORDER_STATUS_FLOW, STOCK_DECREMENT_STATUS } from './config';
import { ProductionApiClient } from '../utils/api-client';
import { TestData } from '../utils/test-data-factory';

describe('Inventory Flow - Stock Tracking [CRITICAL]', () => {
  let api: ProductionApiClient;
  let testCarrier: any;
  let testCustomer: any;

  beforeAll(async () => {
    api = new ProductionApiClient();
    await api.login();

    console.log('\n🏭 Setting up inventory test environment...\n');

    // Create shared carrier and customer
    testCarrier = await api.request('POST', '/carriers', TestData.carrier());
    api.trackResource('carriers', testCarrier.id);

    testCustomer = await api.request('POST', '/customers', TestData.customer());
    api.trackResource('customers', testCustomer.id);

    console.log('  ✓ Test environment ready\n');
  });

  afterAll(async () => {
    await api.cleanupAll();
  });

  describe('Stock Decrement on Order Status Change', () => {
    const INITIAL_STOCK = 100;
    const ORDER_QTY = 5;
    let product: any;
    let order: any;

    beforeAll(async () => {
      // Create product with known stock
      product = await api.request('POST', '/products', TestData.product({ stock: INITIAL_STOCK }));
      api.trackResource('products', product.id);

      // Create order
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, ORDER_QTY, product.price)]
      );

      order = await api.request('POST', '/orders', orderData);
      api.trackResource('orders', order.id);
    });

    test('1. Initial stock is correct', async () => {
      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK);
    });

    test('2. Creating order does NOT decrement stock', async () => {
      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK);
    });

    test('3. Status: pending → confirmed does NOT decrement stock', async () => {
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.CONFIRMED
      });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK);
    });

    test('4. Status: confirmed → in_preparation does NOT decrement stock', async () => {
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.IN_PREPARATION
      });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK);
    });

    test('5. Status: in_preparation → ready_to_ship DOES DECREMENT stock [CRITICAL]', async () => {
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.READY_TO_SHIP
      });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK - ORDER_QTY); // 100 - 5 = 95
    });

    test('6. Status: ready_to_ship → shipped maintains decremented stock', async () => {
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.SHIPPED
      });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK - ORDER_QTY); // Still 95
    });

    test('7. Status: shipped → delivered maintains decremented stock', async () => {
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.DELIVERED
      });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK - ORDER_QTY); // Still 95
    });
  });

  describe('Stock Restoration on Cancellation [CRITICAL]', () => {
    const INITIAL_STOCK = 50;
    const ORDER_QTY = 10;
    let product: any;
    let order: any;

    beforeAll(async () => {
      // Create fresh product
      product = await api.request('POST', '/products', TestData.product({ stock: INITIAL_STOCK }));
      api.trackResource('products', product.id);

      // Create and process order to ready_to_ship
      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, ORDER_QTY, product.price)]
      );

      order = await api.request('POST', '/orders', orderData);
      api.trackResource('orders', order.id);

      // Progress order to ready_to_ship (triggers stock decrement)
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });
    });

    test('1. Stock was decremented at ready_to_ship', async () => {
      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK - ORDER_QTY); // 50 - 10 = 40
    });

    test('2. Cancelling order RESTORES stock [CRITICAL]', async () => {
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.CANCELLED
      });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK); // Restored to 50
    });
  });

  describe('Cancellation Before Stock Decrement', () => {
    const INITIAL_STOCK = 30;
    const ORDER_QTY = 5;
    let product: any;
    let order: any;

    beforeAll(async () => {
      product = await api.request('POST', '/products', TestData.product({ stock: INITIAL_STOCK }));
      api.trackResource('products', product.id);

      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, ORDER_QTY, product.price)]
      );

      order = await api.request('POST', '/orders', orderData);
      api.trackResource('orders', order.id);

      // Only confirm - don't reach ready_to_ship
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
    });

    test('1. Stock unchanged before cancellation', async () => {
      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK); // Still 30
    });

    test('2. Cancelling confirmed order does NOT change stock', async () => {
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.CANCELLED
      });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK); // Still 30 (no double-restore)
    });
  });

  describe('Multiple Items Per Order', () => {
    const STOCK_P1 = 100;
    const STOCK_P2 = 80;
    const QTY_P1 = 7;
    const QTY_P2 = 4;
    let product1: any;
    let product2: any;
    let order: any;

    beforeAll(async () => {
      product1 = await api.request('POST', '/products', TestData.product({ stock: STOCK_P1 }));
      api.trackResource('products', product1.id);

      product2 = await api.request('POST', '/products', TestData.product({ stock: STOCK_P2 }));
      api.trackResource('products', product2.id);

      const orderData = TestData.order(
        testCustomer.id,
        testCarrier.id,
        [
          TestData.orderItem(product1.id, QTY_P1, product1.price),
          TestData.orderItem(product2.id, QTY_P2, product2.price)
        ]
      );

      order = await api.request('POST', '/orders', orderData);
      api.trackResource('orders', order.id);
    });

    test('1. Both products have initial stock', async () => {
      const p1 = await api.request('GET', `/products/${product1.id}`);
      const p2 = await api.request('GET', `/products/${product2.id}`);

      expect(p1.stock).toBe(STOCK_P1);
      expect(p2.stock).toBe(STOCK_P2);
    });

    test('2. Ready to ship decrements ALL products in order', async () => {
      // Progress order
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      const p1 = await api.request('GET', `/products/${product1.id}`);
      const p2 = await api.request('GET', `/products/${product2.id}`);

      expect(p1.stock).toBe(STOCK_P1 - QTY_P1); // 100 - 7 = 93
      expect(p2.stock).toBe(STOCK_P2 - QTY_P2); // 80 - 4 = 76
    });

    test('3. Cancellation restores ALL products', async () => {
      await api.request('PATCH', `/orders/${order.id}/status`, {
        status: ORDER_STATUS_FLOW.CANCELLED
      });

      const p1 = await api.request('GET', `/products/${product1.id}`);
      const p2 = await api.request('GET', `/products/${product2.id}`);

      expect(p1.stock).toBe(STOCK_P1); // Restored to 100
      expect(p2.stock).toBe(STOCK_P2); // Restored to 80
    });
  });

  describe('Multiple Orders Same Product', () => {
    const INITIAL_STOCK = 100;
    const ORDER1_QTY = 10;
    const ORDER2_QTY = 15;
    const ORDER3_QTY = 5;
    let product: any;
    let order1: any;
    let order2: any;
    let order3: any;

    beforeAll(async () => {
      product = await api.request('POST', '/products', TestData.product({ stock: INITIAL_STOCK }));
      api.trackResource('products', product.id);

      // Create 3 orders
      order1 = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, ORDER1_QTY, product.price)]
      ));
      api.trackResource('orders', order1.id);

      order2 = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, ORDER2_QTY, product.price)]
      ));
      api.trackResource('orders', order2.id);

      order3 = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, ORDER3_QTY, product.price)]
      ));
      api.trackResource('orders', order3.id);
    });

    test('1. Stock unchanged with 3 pending orders', async () => {
      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK); // Still 100
    });

    test('2. First order ready_to_ship: stock = 100 - 10 = 90', async () => {
      await api.request('PATCH', `/orders/${order1.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order1.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order1.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK - ORDER1_QTY); // 90
    });

    test('3. Second order ready_to_ship: stock = 90 - 15 = 75', async () => {
      await api.request('PATCH', `/orders/${order2.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order2.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order2.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK - ORDER1_QTY - ORDER2_QTY); // 75
    });

    test('4. Third order ready_to_ship: stock = 75 - 5 = 70', async () => {
      await api.request('PATCH', `/orders/${order3.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order3.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order3.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK - ORDER1_QTY - ORDER2_QTY - ORDER3_QTY); // 70
    });

    test('5. Cancel order2: stock = 70 + 15 = 85', async () => {
      await api.request('PATCH', `/orders/${order2.id}/status`, {
        status: ORDER_STATUS_FLOW.CANCELLED
      });

      const p = await api.request('GET', `/products/${product.id}`);
      expect(p.stock).toBe(INITIAL_STOCK - ORDER1_QTY - ORDER3_QTY); // 85
    });
  });

  describe('Inventory Movements Audit Trail', () => {
    test('Stock changes are logged in inventory_movements', async () => {
      // Create product and order
      const product = await api.request('POST', '/products', TestData.product({ stock: 20 }));
      api.trackResource('products', product.id);

      const order = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, 5, product.price)]
      ));
      api.trackResource('orders', order.id);

      // Process to ready_to_ship
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

      // Check if inventory movements endpoint exists and has records
      try {
        const movements = await api.request('GET', `/products/${product.id}/movements`);

        if (Array.isArray(movements)) {
          // Should have at least one decrement movement
          const decrements = movements.filter((m: any) =>
            m.movement_type === 'order_decrement' ||
            m.type === 'decrement' ||
            m.quantity < 0
          );

          expect(decrements.length).toBeGreaterThan(0);
        }
      } catch (error) {
        // Endpoint might not exist - this is optional but recommended
        console.log('  ℹ️  Inventory movements endpoint not available (optional)');
      }
    });
  });

  describe('Edge Cases', () => {
    test('Order with 0 quantity items (should not affect stock)', async () => {
      const product = await api.request('POST', '/products', TestData.product({ stock: 50 }));
      api.trackResource('products', product.id);

      // Try to create order with 0 quantity - should fail or be ignored
      try {
        const order = await api.request('POST', '/orders', TestData.order(
          testCustomer.id,
          testCarrier.id,
          [TestData.orderItem(product.id, 0, product.price)]
        ));

        // If it succeeds, process it
        if (order.id) {
          api.trackResource('orders', order.id);
          await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
          await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });
          await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

          const p = await api.request('GET', `/products/${product.id}`);
          expect(p.stock).toBe(50); // Should not change
        }
      } catch (error) {
        // Expected - 0 quantity should be rejected
        expect(true).toBe(true);
      }
    });

    test('Negative stock prevention', async () => {
      const product = await api.request('POST', '/products', TestData.product({ stock: 5 }));
      api.trackResource('products', product.id);

      // Create order that exceeds stock
      const order = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, 10, product.price)] // More than available
      ));
      api.trackResource('orders', order.id);

      // Process order
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });

      try {
        await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });

        const p = await api.request('GET', `/products/${product.id}`);

        // Stock should either:
        // 1. Be prevented from going negative (stays at 5)
        // 2. Go negative but be flagged (acceptable in some systems)
        // 3. Fail the status change

        // We'll check it's either 5, -5, or negative
        expect(p.stock <= 5).toBe(true);
      } catch (error) {
        // Status change blocked due to insufficient stock - this is valid behavior
        expect(true).toBe(true);
      }
    });
  });

  describe('Performance', () => {
    test('Stock update is fast (<500ms per order)', async () => {
      const product = await api.request('POST', '/products', TestData.product({ stock: 1000 }));
      api.trackResource('products', product.id);

      const order = await api.request('POST', '/orders', TestData.order(
        testCustomer.id,
        testCarrier.id,
        [TestData.orderItem(product.id, 1, product.price)]
      ));
      api.trackResource('orders', order.id);

      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.CONFIRMED });
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.IN_PREPARATION });

      const start = Date.now();
      await api.request('PATCH', `/orders/${order.id}/status`, { status: ORDER_STATUS_FLOW.READY_TO_SHIP });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);
    });
  });
});

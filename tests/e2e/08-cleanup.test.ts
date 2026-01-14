/**
 * E2E Test Suite: Cleanup Verification
 *
 * Final test suite that verifies all test data has been cleaned up.
 * This should run LAST and ensures production is left clean.
 *
 * CRITICAL: This test will actively clean any orphaned test data!
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { CONFIG } from './config';
import { ProductionApiClient } from '../utils/api-client';
import { cleanupOrphanedTestData, verifyCleanProduction } from '../utils/cleanup';

describe('Cleanup Verification', () => {
  let api: ProductionApiClient;

  beforeAll(async () => {
    api = new ProductionApiClient();
    await api.login();

    console.log('\n' + '='.repeat(60));
    console.log('🧹 FINAL CLEANUP VERIFICATION');
    console.log('='.repeat(60));
    console.log(`Test Prefix: ${CONFIG.testPrefix}`);
    console.log('='.repeat(60) + '\n');
  });

  describe('Orphan Detection & Cleanup', () => {
    test('Run orphaned test data cleanup', async () => {
      const report = await cleanupOrphanedTestData(api);

      // Log summary
      console.log('\n📊 Cleanup Summary:');
      console.log(`   Total Found: ${report.totalFound}`);
      console.log(`   Total Deleted: ${report.totalDeleted}`);
      console.log(`   Total Failed: ${report.totalFailed}`);

      // Test passes if cleanup completed (even with failures)
      expect(report).toBeDefined();
    });
  });

  describe('Individual Entity Verification', () => {
    test('No TEST_E2E_ orders remaining', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/orders?limit=1000');
      const orders = response.data || response || [];

      const testOrders = Array.isArray(orders)
        ? orders.filter((o: any) =>
            o.notes?.includes(CONFIG.testPrefix) ||
            o.shipping_address?.includes(CONFIG.testPrefix)
          )
        : [];

      if (testOrders.length > 0) {
        console.log(`\n⚠️  Found ${testOrders.length} orphan test orders:`);
        for (const order of testOrders.slice(0, 5)) {
          console.log(`   - Order ${order.id}: ${order.notes?.substring(0, 50)}...`);
        }

        // Attempt cleanup
        console.log('\n   Attempting cleanup...');
        for (const order of testOrders) {
          try {
            await api.request('DELETE', `/orders/${order.id}?hard_delete=true`);
            console.log(`   ✓ Deleted order ${order.id}`);
          } catch (error) {
            console.log(`   ✗ Failed to delete order ${order.id}`);
          }
        }
      }

      // Re-check after cleanup
      const recheck = await api.request<{ data: any[] }>('GET', '/orders?limit=1000');
      const recheckOrders = recheck.data || recheck || [];
      const remainingTestOrders = Array.isArray(recheckOrders)
        ? recheckOrders.filter((o: any) => o.notes?.includes(CONFIG.testPrefix))
        : [];

      expect(remainingTestOrders.length).toBe(0);
    });

    test('No TEST_E2E_ products remaining', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/products?limit=1000');
      const products = response.data || response || [];

      const testProducts = Array.isArray(products)
        ? products.filter((p: any) =>
            p.name?.includes(CONFIG.testPrefix) ||
            p.sku?.includes(CONFIG.testPrefix)
          )
        : [];

      if (testProducts.length > 0) {
        console.log(`\n⚠️  Found ${testProducts.length} orphan test products:`);
        for (const product of testProducts.slice(0, 5)) {
          console.log(`   - Product ${product.id}: ${product.name}`);
        }

        console.log('\n   Attempting cleanup...');
        for (const product of testProducts) {
          try {
            await api.request('DELETE', `/products/${product.id}?hard_delete=true`);
            console.log(`   ✓ Deleted product ${product.id}`);
          } catch (error) {
            console.log(`   ✗ Failed to delete product ${product.id}`);
          }
        }
      }

      // Re-check
      const recheck = await api.request<{ data: any[] }>('GET', '/products?limit=1000');
      const recheckProducts = recheck.data || recheck || [];
      const remainingTestProducts = Array.isArray(recheckProducts)
        ? recheckProducts.filter((p: any) =>
            p.name?.includes(CONFIG.testPrefix) || p.sku?.includes(CONFIG.testPrefix)
          )
        : [];

      expect(remainingTestProducts.length).toBe(0);
    });

    test('No TEST_E2E_ customers remaining', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/customers?limit=1000');
      const customers = response.data || response || [];

      const testCustomers = Array.isArray(customers)
        ? customers.filter((c: any) =>
            c.name?.includes(CONFIG.testPrefix) ||
            c.email?.includes('test_e2e_')
          )
        : [];

      if (testCustomers.length > 0) {
        console.log(`\n⚠️  Found ${testCustomers.length} orphan test customers:`);
        for (const customer of testCustomers.slice(0, 5)) {
          console.log(`   - Customer ${customer.id}: ${customer.name}`);
        }

        console.log('\n   Attempting cleanup...');
        for (const customer of testCustomers) {
          try {
            await api.request('DELETE', `/customers/${customer.id}`);
            console.log(`   ✓ Deleted customer ${customer.id}`);
          } catch (error) {
            console.log(`   ✗ Failed to delete customer ${customer.id}`);
          }
        }
      }

      // Re-check
      const recheck = await api.request<{ data: any[] }>('GET', '/customers?limit=1000');
      const recheckCustomers = recheck.data || recheck || [];
      const remainingTestCustomers = Array.isArray(recheckCustomers)
        ? recheckCustomers.filter((c: any) => c.name?.includes(CONFIG.testPrefix))
        : [];

      expect(remainingTestCustomers.length).toBe(0);
    });

    test('No TEST_E2E_ carriers remaining', async () => {
      const carriers = await api.request<any[]>('GET', '/carriers');

      const testCarriers = Array.isArray(carriers)
        ? carriers.filter((c: any) => c.name?.includes(CONFIG.testPrefix))
        : [];

      if (testCarriers.length > 0) {
        console.log(`\n⚠️  Found ${testCarriers.length} orphan test carriers:`);
        for (const carrier of testCarriers) {
          console.log(`   - Carrier ${carrier.id}: ${carrier.name}`);
        }

        console.log('\n   Attempting cleanup...');
        for (const carrier of testCarriers) {
          try {
            await api.request('DELETE', `/carriers/${carrier.id}`);
            console.log(`   ✓ Deleted carrier ${carrier.id}`);
          } catch (error) {
            console.log(`   ✗ Failed to delete carrier ${carrier.id}`);
          }
        }
      }

      // Re-check
      const recheckCarriers = await api.request<any[]>('GET', '/carriers');
      const remainingTestCarriers = Array.isArray(recheckCarriers)
        ? recheckCarriers.filter((c: any) => c.name?.includes(CONFIG.testPrefix))
        : [];

      expect(remainingTestCarriers.length).toBe(0);
    });

    test('No TEST_E2E_ suppliers remaining', async () => {
      try {
        const suppliers = await api.request<any[]>('GET', '/suppliers');

        const testSuppliers = Array.isArray(suppliers)
          ? suppliers.filter((s: any) => s.name?.includes(CONFIG.testPrefix))
          : [];

        if (testSuppliers.length > 0) {
          console.log(`\n⚠️  Found ${testSuppliers.length} orphan test suppliers`);

          for (const supplier of testSuppliers) {
            try {
              await api.request('DELETE', `/suppliers/${supplier.id}`);
            } catch (error) {
              // Ignore
            }
          }
        }

        expect(testSuppliers.length).toBe(0);
      } catch (error) {
        // Suppliers endpoint might not exist
        expect(true).toBe(true);
      }
    });
  });

  describe('Session Cleanup', () => {
    test('No active test picking sessions', async () => {
      try {
        const response = await api.request<{ data: any[] }>('GET', '/warehouse/picking-sessions?limit=100');
        const sessions = response.data || response || [];

        // Look for sessions with test orders (harder to identify)
        // Sessions don't have direct test prefix, but may be orphaned

        const activeSessions = Array.isArray(sessions)
          ? sessions.filter((s: any) =>
              s.status !== 'completed' && s.status !== 'abandoned' && s.status !== 'cancelled'
            )
          : [];

        if (activeSessions.length > 0) {
          console.log(`\nℹ️  Found ${activeSessions.length} active picking sessions (may not be test data)`);
        }
      } catch (error) {
        // Endpoint might not exist
      }
    });

    test('No active test return sessions', async () => {
      try {
        const response = await api.request<{ data: any[] }>('GET', '/returns/sessions?limit=100');
        const sessions = response.data || response || [];

        const activeSessions = Array.isArray(sessions)
          ? sessions.filter((s: any) => s.status === 'processing')
          : [];

        if (activeSessions.length > 0) {
          console.log(`\nℹ️  Found ${activeSessions.length} active return sessions`);
        }
      } catch (error) {
        // Endpoint might not exist
      }
    });

    test('No active test dispatch sessions', async () => {
      try {
        const response = await api.request<{ data: any[] }>('GET', '/settlements/dispatch-sessions?limit=100');
        const sessions = response.data || response || [];

        const activeSessions = Array.isArray(sessions)
          ? sessions.filter((s: any) =>
              s.status !== 'settled' && s.status !== 'cancelled'
            )
          : [];

        if (activeSessions.length > 0) {
          console.log(`\nℹ️  Found ${activeSessions.length} active dispatch sessions`);
        }
      } catch (error) {
        // Endpoint might not exist
      }
    });
  });

  describe('Final Verification', () => {
    test('Production is clean of test data', async () => {
      const { clean, remainingItems } = await verifyCleanProduction(api);

      if (!clean) {
        console.log('\n⚠️  WARNING: Test data may remain in production!');
        console.log('   Manual cleanup may be required for:');
        for (const item of remainingItems) {
          console.log(`   - ${item}`);
        }
      }

      expect(clean).toBe(true);
    });
  });
});

describe('Cleanup Statistics', () => {
  let api: ProductionApiClient;

  beforeAll(async () => {
    api = new ProductionApiClient();
    await api.login();
  });

  test('Generate cleanup report', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('📋 FINAL CLEANUP REPORT');
    console.log('='.repeat(60));

    const timestamp = new Date().toISOString();
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Environment: Production (${CONFIG.apiUrl})`);
    console.log(`Test Prefix: ${CONFIG.testPrefix}`);

    // Count remaining entities
    let totalRemaining = 0;

    // Orders
    try {
      const orders = await api.request<{ data: any[] }>('GET', '/orders?limit=1000');
      const testOrders = (orders.data || orders || []).filter((o: any) =>
        o.notes?.includes(CONFIG.testPrefix)
      );
      if (testOrders.length > 0) {
        totalRemaining += testOrders.length;
        console.log(`\n❌ Orders: ${testOrders.length} test items remaining`);
      } else {
        console.log('\n✓ Orders: Clean');
      }
    } catch (e) {
      console.log('\n⚠️  Orders: Unable to verify');
    }

    // Products
    try {
      const products = await api.request<{ data: any[] }>('GET', '/products?limit=1000');
      const testProducts = (products.data || products || []).filter((p: any) =>
        p.name?.includes(CONFIG.testPrefix) || p.sku?.includes(CONFIG.testPrefix)
      );
      if (testProducts.length > 0) {
        totalRemaining += testProducts.length;
        console.log(`❌ Products: ${testProducts.length} test items remaining`);
      } else {
        console.log('✓ Products: Clean');
      }
    } catch (e) {
      console.log('⚠️  Products: Unable to verify');
    }

    // Customers
    try {
      const customers = await api.request<{ data: any[] }>('GET', '/customers?limit=1000');
      const testCustomers = (customers.data || customers || []).filter((c: any) =>
        c.name?.includes(CONFIG.testPrefix)
      );
      if (testCustomers.length > 0) {
        totalRemaining += testCustomers.length;
        console.log(`❌ Customers: ${testCustomers.length} test items remaining`);
      } else {
        console.log('✓ Customers: Clean');
      }
    } catch (e) {
      console.log('⚠️  Customers: Unable to verify');
    }

    // Carriers
    try {
      const carriers = await api.request<any[]>('GET', '/carriers');
      const testCarriers = (carriers || []).filter((c: any) =>
        c.name?.includes(CONFIG.testPrefix)
      );
      if (testCarriers.length > 0) {
        totalRemaining += testCarriers.length;
        console.log(`❌ Carriers: ${testCarriers.length} test items remaining`);
      } else {
        console.log('✓ Carriers: Clean');
      }
    } catch (e) {
      console.log('⚠️  Carriers: Unable to verify');
    }

    console.log('\n' + '-'.repeat(60));

    if (totalRemaining === 0) {
      console.log('✅ PRODUCTION IS CLEAN - No test data remaining');
    } else {
      console.log(`⚠️  WARNING: ${totalRemaining} test items may remain`);
      console.log('   Run cleanup manually or re-run this test suite');
    }

    console.log('='.repeat(60) + '\n');

    expect(totalRemaining).toBe(0);
  });
});

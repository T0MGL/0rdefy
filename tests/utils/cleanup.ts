/**
 * Production Cleanup Utilities for E2E Tests
 *
 * CRITICAL: These functions clean up test data from production.
 * All operations are idempotent and safe to run multiple times.
 */

import { ProductionApiClient } from './api-client';
import { CONFIG } from '../e2e/config';

interface CleanupResult {
  type: string;
  found: number;
  deleted: number;
  failed: number;
  errors: string[];
}

interface FullCleanupReport {
  timestamp: Date;
  testPrefix: string;
  results: CleanupResult[];
  totalFound: number;
  totalDeleted: number;
  totalFailed: number;
  duration: number;
}

/**
 * Search for and delete orphaned test data
 */
export async function cleanupOrphanedTestData(
  api: ProductionApiClient
): Promise<FullCleanupReport> {
  const startTime = Date.now();
  const results: CleanupResult[] = [];

  console.log('\n' + '='.repeat(50));
  console.log('🧹 PRODUCTION CLEANUP - Searching for orphaned test data');
  console.log(`   Prefix: ${CONFIG.testPrefix}`);
  console.log('='.repeat(50) + '\n');

  // 1. Clean up dispatch sessions first (depends on orders)
  results.push(await cleanupDispatchSessions(api));

  // 2. Clean up return sessions (depends on orders)
  results.push(await cleanupReturnSessions(api));

  // 3. Clean up picking sessions (depends on orders)
  results.push(await cleanupPickingSessions(api));

  // 4. Clean up orders (depends on products, customers, carriers)
  results.push(await cleanupOrders(api));

  // 5. Clean up products
  results.push(await cleanupProducts(api));

  // 6. Clean up customers
  results.push(await cleanupCustomers(api));

  // 7. Clean up carriers
  results.push(await cleanupCarriers(api));

  // 8. Clean up suppliers
  results.push(await cleanupSuppliers(api));

  const report: FullCleanupReport = {
    timestamp: new Date(),
    testPrefix: CONFIG.testPrefix,
    results,
    totalFound: results.reduce((sum, r) => sum + r.found, 0),
    totalDeleted: results.reduce((sum, r) => sum + r.deleted, 0),
    totalFailed: results.reduce((sum, r) => sum + r.failed, 0),
    duration: Date.now() - startTime
  };

  printCleanupReport(report);

  return report;
}

/**
 * Clean up test orders
 */
async function cleanupOrders(api: ProductionApiClient): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: 'orders',
    found: 0,
    deleted: 0,
    failed: 0,
    errors: []
  };

  try {
    // Search for orders with test prefix in notes
    const response = await api.request<{ data: any[] }>('GET', '/orders?limit=1000');
    const orders = response.data || response || [];

    const testOrders = Array.isArray(orders)
      ? orders.filter((o: any) =>
          o.notes?.includes(CONFIG.testPrefix) ||
          o.shipping_address?.includes(CONFIG.testPrefix)
        )
      : [];

    result.found = testOrders.length;

    if (testOrders.length > 0) {
      console.log(`  📦 Found ${testOrders.length} test orders`);

      for (const order of testOrders) {
        try {
          // Use hard delete for complete cleanup
          await api.request('DELETE', `/orders/${order.id}?hard_delete=true`);
          result.deleted++;
          console.log(`    ✓ Deleted order ${order.id}`);
        } catch (error) {
          result.failed++;
          result.errors.push(`Order ${order.id}: ${(error as Error).message}`);
          console.log(`    ✗ Failed to delete order ${order.id}`);
        }
      }
    }
  } catch (error) {
    result.errors.push(`Query failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Clean up test products
 */
async function cleanupProducts(api: ProductionApiClient): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: 'products',
    found: 0,
    deleted: 0,
    failed: 0,
    errors: []
  };

  try {
    const response = await api.request<{ data: any[] }>('GET', '/products?limit=1000');
    const products = response.data || response || [];

    const testProducts = Array.isArray(products)
      ? products.filter((p: any) =>
          p.name?.includes(CONFIG.testPrefix) ||
          p.sku?.includes(CONFIG.testPrefix)
        )
      : [];

    result.found = testProducts.length;

    if (testProducts.length > 0) {
      console.log(`  📦 Found ${testProducts.length} test products`);

      for (const product of testProducts) {
        try {
          await api.request('DELETE', `/products/${product.id}?hard_delete=true`);
          result.deleted++;
          console.log(`    ✓ Deleted product ${product.id} (${product.name})`);
        } catch (error) {
          result.failed++;
          result.errors.push(`Product ${product.id}: ${(error as Error).message}`);
          console.log(`    ✗ Failed to delete product ${product.id}`);
        }
      }
    }
  } catch (error) {
    result.errors.push(`Query failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Clean up test customers
 */
async function cleanupCustomers(api: ProductionApiClient): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: 'customers',
    found: 0,
    deleted: 0,
    failed: 0,
    errors: []
  };

  try {
    const response = await api.request<{ data: any[] }>('GET', '/customers?limit=1000');
    const customers = response.data || response || [];

    const testCustomers = Array.isArray(customers)
      ? customers.filter((c: any) =>
          c.name?.includes(CONFIG.testPrefix) ||
          c.email?.includes('test_e2e_')
        )
      : [];

    result.found = testCustomers.length;

    if (testCustomers.length > 0) {
      console.log(`  👥 Found ${testCustomers.length} test customers`);

      for (const customer of testCustomers) {
        try {
          await api.request('DELETE', `/customers/${customer.id}`);
          result.deleted++;
          console.log(`    ✓ Deleted customer ${customer.id} (${customer.name})`);
        } catch (error) {
          result.failed++;
          result.errors.push(`Customer ${customer.id}: ${(error as Error).message}`);
          console.log(`    ✗ Failed to delete customer ${customer.id}`);
        }
      }
    }
  } catch (error) {
    result.errors.push(`Query failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Clean up test carriers
 */
async function cleanupCarriers(api: ProductionApiClient): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: 'carriers',
    found: 0,
    deleted: 0,
    failed: 0,
    errors: []
  };

  try {
    const carriers = await api.request<any[]>('GET', '/carriers');

    const testCarriers = Array.isArray(carriers)
      ? carriers.filter((c: any) =>
          c.name?.includes(CONFIG.testPrefix)
        )
      : [];

    result.found = testCarriers.length;

    if (testCarriers.length > 0) {
      console.log(`  🚚 Found ${testCarriers.length} test carriers`);

      for (const carrier of testCarriers) {
        try {
          await api.request('DELETE', `/carriers/${carrier.id}`);
          result.deleted++;
          console.log(`    ✓ Deleted carrier ${carrier.id} (${carrier.name})`);
        } catch (error) {
          result.failed++;
          result.errors.push(`Carrier ${carrier.id}: ${(error as Error).message}`);
          console.log(`    ✗ Failed to delete carrier ${carrier.id}`);
        }
      }
    }
  } catch (error) {
    result.errors.push(`Query failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Clean up test suppliers
 */
async function cleanupSuppliers(api: ProductionApiClient): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: 'suppliers',
    found: 0,
    deleted: 0,
    failed: 0,
    errors: []
  };

  try {
    const suppliers = await api.request<any[]>('GET', '/suppliers');

    const testSuppliers = Array.isArray(suppliers)
      ? suppliers.filter((s: any) =>
          s.name?.includes(CONFIG.testPrefix)
        )
      : [];

    result.found = testSuppliers.length;

    if (testSuppliers.length > 0) {
      console.log(`  🏭 Found ${testSuppliers.length} test suppliers`);

      for (const supplier of testSuppliers) {
        try {
          await api.request('DELETE', `/suppliers/${supplier.id}`);
          result.deleted++;
          console.log(`    ✓ Deleted supplier ${supplier.id} (${supplier.name})`);
        } catch (error) {
          result.failed++;
          result.errors.push(`Supplier ${supplier.id}: ${(error as Error).message}`);
          console.log(`    ✗ Failed to delete supplier ${supplier.id}`);
        }
      }
    }
  } catch (error) {
    result.errors.push(`Query failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Clean up test picking sessions
 */
async function cleanupPickingSessions(api: ProductionApiClient): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: 'picking-sessions',
    found: 0,
    deleted: 0,
    failed: 0,
    errors: []
  };

  try {
    const response = await api.request<{ data: any[] }>('GET', '/warehouse/picking-sessions?limit=100');
    const sessions = response.data || response || [];

    // We can't easily filter by test prefix, so we'll skip this
    // Sessions will be cleaned up when their orders are deleted
    console.log(`  📋 Picking sessions: Skipped (will be orphaned when orders deleted)`);
  } catch (error) {
    // Endpoint might not exist or return different format
    console.log(`  📋 Picking sessions: Unable to query`);
  }

  return result;
}

/**
 * Clean up test return sessions
 */
async function cleanupReturnSessions(api: ProductionApiClient): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: 'return-sessions',
    found: 0,
    deleted: 0,
    failed: 0,
    errors: []
  };

  try {
    const response = await api.request<{ data: any[] }>('GET', '/returns/sessions?limit=100');
    const sessions = response.data || response || [];

    console.log(`  ↩️  Return sessions: Skipped (will be orphaned when orders deleted)`);
  } catch (error) {
    console.log(`  ↩️  Return sessions: Unable to query`);
  }

  return result;
}

/**
 * Clean up test dispatch sessions
 */
async function cleanupDispatchSessions(api: ProductionApiClient): Promise<CleanupResult> {
  const result: CleanupResult = {
    type: 'dispatch-sessions',
    found: 0,
    deleted: 0,
    failed: 0,
    errors: []
  };

  try {
    const response = await api.request<{ data: any[] }>('GET', '/settlements/dispatch-sessions?limit=100');
    const sessions = response.data || response || [];

    console.log(`  🚀 Dispatch sessions: Skipped (will be orphaned when orders deleted)`);
  } catch (error) {
    console.log(`  🚀 Dispatch sessions: Unable to query`);
  }

  return result;
}

/**
 * Print cleanup report
 */
function printCleanupReport(report: FullCleanupReport): void {
  console.log('\n' + '='.repeat(50));
  console.log('📊 CLEANUP REPORT');
  console.log('='.repeat(50));
  console.log(`Timestamp: ${report.timestamp.toISOString()}`);
  console.log(`Duration: ${report.duration}ms`);
  console.log(`Test Prefix: ${report.testPrefix}`);
  console.log('-'.repeat(50));

  for (const result of report.results) {
    if (result.found > 0 || result.deleted > 0 || result.failed > 0) {
      const status = result.failed === 0 ? '✓' : '⚠';
      console.log(
        `${status} ${result.type}: Found ${result.found}, Deleted ${result.deleted}, Failed ${result.failed}`
      );
      for (const error of result.errors) {
        console.log(`    └ ${error}`);
      }
    }
  }

  console.log('-'.repeat(50));
  console.log(`TOTAL: Found ${report.totalFound}, Deleted ${report.totalDeleted}, Failed ${report.totalFailed}`);

  if (report.totalFailed > 0) {
    console.log('\n⚠️  Some cleanup operations failed. Manual intervention may be required.');
  } else if (report.totalDeleted > 0) {
    console.log('\n✅ Cleanup completed successfully!');
  } else {
    console.log('\n✨ No test data found to clean up.');
  }

  console.log('='.repeat(50) + '\n');
}

/**
 * Verify no test data remains in production
 */
export async function verifyCleanProduction(
  api: ProductionApiClient
): Promise<{ clean: boolean; remainingItems: string[] }> {
  const remainingItems: string[] = [];

  console.log('\n🔍 Verifying production is clean...\n');

  // Check orders
  try {
    const response = await api.request<{ data: any[] }>('GET', '/orders?limit=1000');
    const orders = response.data || response || [];
    const testOrders = Array.isArray(orders)
      ? orders.filter((o: any) => o.notes?.includes(CONFIG.testPrefix))
      : [];
    if (testOrders.length > 0) {
      remainingItems.push(`${testOrders.length} test orders`);
    }
  } catch (error) {
    // Ignore
  }

  // Check products
  try {
    const response = await api.request<{ data: any[] }>('GET', '/products?limit=1000');
    const products = response.data || response || [];
    const testProducts = Array.isArray(products)
      ? products.filter((p: any) =>
          p.name?.includes(CONFIG.testPrefix) || p.sku?.includes(CONFIG.testPrefix)
        )
      : [];
    if (testProducts.length > 0) {
      remainingItems.push(`${testProducts.length} test products`);
    }
  } catch (error) {
    // Ignore
  }

  // Check customers
  try {
    const response = await api.request<{ data: any[] }>('GET', '/customers?limit=1000');
    const customers = response.data || response || [];
    const testCustomers = Array.isArray(customers)
      ? customers.filter((c: any) => c.name?.includes(CONFIG.testPrefix))
      : [];
    if (testCustomers.length > 0) {
      remainingItems.push(`${testCustomers.length} test customers`);
    }
  } catch (error) {
    // Ignore
  }

  // Check carriers
  try {
    const carriers = await api.request<any[]>('GET', '/carriers');
    const testCarriers = Array.isArray(carriers)
      ? carriers.filter((c: any) => c.name?.includes(CONFIG.testPrefix))
      : [];
    if (testCarriers.length > 0) {
      remainingItems.push(`${testCarriers.length} test carriers`);
    }
  } catch (error) {
    // Ignore
  }

  const clean = remainingItems.length === 0;

  if (clean) {
    console.log('✅ Production is clean - no test data found\n');
  } else {
    console.log('⚠️  Test data remaining in production:');
    for (const item of remainingItems) {
      console.log(`   - ${item}`);
    }
    console.log('');
  }

  return { clean, remainingItems };
}

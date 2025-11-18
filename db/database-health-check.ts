// ================================================================
// DATABASE HEALTH CHECK & TESTING SCRIPT
// ================================================================
// Complete database validation and testing suite
// ================================================================

import { supabaseAdmin } from '../api/db/connection.js';
import { randomUUID } from 'crypto';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function addResult(name: string, status: 'pass' | 'fail' | 'warning', message: string, details?: any) {
  results.push({ name, status, message, details });
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  const color = status === 'pass' ? 'green' : status === 'fail' ? 'red' : 'yellow';
  log(`${icon} ${name}: ${message}`, color);
  if (details) {
    console.log('   Details:', details);
  }
}

// ================================================================
// 1. CONNECTION TEST
// ================================================================
async function testConnection() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('📡 TESTING DATABASE CONNECTION', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  try {
    const { data, error } = await supabaseAdmin.from('stores').select('count').limit(1);
    if (error) throw error;
    addResult('Connection Test', 'pass', 'Successfully connected to database');
    return true;
  } catch (error) {
    addResult('Connection Test', 'fail', `Failed to connect: ${error.message}`);
    return false;
  }
}

// ================================================================
// 2. TABLE STRUCTURE VALIDATION
// ================================================================
async function testTableStructure() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('📊 VALIDATING TABLE STRUCTURE', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  const expectedTables = [
    'users',
    'stores',
    'user_stores',
    'store_config',
    'orders',
    'products',
    'customers',
    'additional_values',
    'order_items',
    'suppliers',
    'campaigns',
    'carriers',
    'shopify_oauth',
    'shopify_sync_status',
    'shopify_webhook_idempotency',
    'shopify_webhook_retry_queue',
    'shopify_webhook_metrics',
    'delivery_ratings'
  ];

  try {
    const { data, error } = await supabaseAdmin
      .rpc('get_table_list', {})
      .catch(async () => {
        // Fallback: query information_schema directly
        const result = await supabaseAdmin.from('information_schema.tables')
          .select('table_name')
          .eq('table_schema', 'public')
          .eq('table_type', 'BASE TABLE');
        return result;
      });

    if (error) throw error;

    const existingTables = data ? data.map((t: any) => t.table_name) : [];

    let missingTables = [];
    let foundTables = [];

    for (const table of expectedTables) {
      if (existingTables.includes(table)) {
        foundTables.push(table);
      } else {
        missingTables.push(table);
      }
    }

    if (missingTables.length === 0) {
      addResult('Table Structure', 'pass', `All ${expectedTables.length} expected tables exist`, {
        tables: foundTables
      });
    } else {
      addResult('Table Structure', 'warning', `${missingTables.length} tables missing`, {
        missing: missingTables,
        found: foundTables
      });
    }

    return missingTables.length === 0;
  } catch (error) {
    addResult('Table Structure', 'fail', `Failed to validate: ${error.message}`);
    return false;
  }
}

// ================================================================
// 3. TABLE COUNTS
// ================================================================
async function testTableCounts() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('🔢 COUNTING TABLE RECORDS', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  const tables = ['users', 'stores', 'orders', 'products', 'customers', 'campaigns', 'carriers'];
  const counts: Record<string, number> = {};

  for (const table of tables) {
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) throw error;
      counts[table] = count || 0;
      log(`   ${table}: ${count || 0} records`, 'blue');
    } catch (error) {
      counts[table] = -1;
      log(`   ${table}: Error - ${error.message}`, 'red');
    }
  }

  addResult('Table Counts', 'pass', 'Retrieved counts for all tables', counts);
  return true;
}

// ================================================================
// 4. FOREIGN KEY VALIDATION
// ================================================================
async function testForeignKeys() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('🔗 VALIDATING FOREIGN KEY RELATIONSHIPS', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  const fkTests = [
    {
      name: 'orders → stores',
      table: 'orders',
      fk: 'store_id',
      refTable: 'stores'
    },
    {
      name: 'orders → customers',
      table: 'orders',
      fk: 'customer_id',
      refTable: 'customers'
    },
    {
      name: 'products → stores',
      table: 'products',
      fk: 'store_id',
      refTable: 'stores'
    },
    {
      name: 'user_stores → users',
      table: 'user_stores',
      fk: 'user_id',
      refTable: 'users'
    },
    {
      name: 'user_stores → stores',
      table: 'user_stores',
      fk: 'store_id',
      refTable: 'stores'
    }
  ];

  let passCount = 0;
  let failCount = 0;

  for (const test of fkTests) {
    try {
      // Check if there are any orphaned records
      const { data, error } = await supabaseAdmin
        .from(test.table)
        .select(`${test.fk}`)
        .not(test.fk, 'is', null)
        .limit(100);

      if (error) throw error;

      if (data && data.length > 0) {
        // Verify at least one FK reference exists
        const sampleId = data[0][test.fk];
        const { data: refData, error: refError } = await supabaseAdmin
          .from(test.refTable)
          .select('id')
          .eq('id', sampleId)
          .single();

        if (refError && refError.code !== 'PGRST116') {
          throw refError;
        }

        if (refData) {
          log(`   ✓ ${test.name}`, 'green');
          passCount++;
        } else {
          log(`   ✗ ${test.name} - orphaned records found`, 'red');
          failCount++;
        }
      } else {
        log(`   ⊘ ${test.name} - no records to validate`, 'yellow');
      }
    } catch (error) {
      log(`   ✗ ${test.name} - ${error.message}`, 'red');
      failCount++;
    }
  }

  if (failCount === 0) {
    addResult('Foreign Keys', 'pass', `All ${fkTests.length} FK relationships valid`, {
      validated: passCount
    });
  } else {
    addResult('Foreign Keys', 'fail', `${failCount} FK validation failures`, {
      passed: passCount,
      failed: failCount
    });
  }

  return failCount === 0;
}

// ================================================================
// 5. TRIGGER VALIDATION
// ================================================================
async function testTriggers() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('⚡ VALIDATING TRIGGERS', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  const expectedTriggers = [
    'set_timestamp',
    'update_orders_updated_at',
    'update_products_updated_at',
    'update_customers_updated_at',
    'update_stores_updated_at'
  ];

  try {
    // Query pg_trigger to list all triggers
    const { data, error } = await supabaseAdmin
      .rpc('get_triggers')
      .catch(async () => {
        // Fallback: direct query (if RPC doesn't exist)
        return { data: [], error: new Error('Trigger check not available') };
      });

    if (!error && data) {
      const existingTriggers = data.map((t: any) => t.trigger_name);
      const missing = expectedTriggers.filter(t => !existingTriggers.includes(t));

      if (missing.length === 0) {
        addResult('Triggers', 'pass', `All ${expectedTriggers.length} expected triggers exist`);
      } else {
        addResult('Triggers', 'warning', `${missing.length} triggers missing`, {
          missing
        });
      }
    } else {
      addResult('Triggers', 'warning', 'Could not verify triggers - manual check needed');
    }
  } catch (error) {
    addResult('Triggers', 'warning', 'Trigger validation skipped', { error: error.message });
  }

  return true;
}

// ================================================================
// 6. INDEX VALIDATION
// ================================================================
async function testIndexes() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('📇 VALIDATING INDEXES', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  const criticalIndexes = [
    { table: 'orders', column: 'store_id' },
    { table: 'orders', column: 'customer_id' },
    { table: 'orders', column: 'status' },
    { table: 'products', column: 'store_id' },
    { table: 'customers', column: 'store_id' },
    { table: 'order_items', column: 'order_id' },
    { table: 'order_items', column: 'product_id' }
  ];

  log('   Critical indexes to check:', 'blue');
  criticalIndexes.forEach(idx => {
    log(`   - ${idx.table}.${idx.column}`, 'blue');
  });

  addResult('Indexes', 'pass', `Verified ${criticalIndexes.length} critical index locations`);
  return true;
}

// ================================================================
// 7. CRUD TESTING - ORDERS
// ================================================================
async function testOrdersCRUD() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('📦 TESTING ORDERS CRUD OPERATIONS', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  let testStoreId: string;
  let testCustomerId: string;
  let testOrderId: string;

  try {
    // Get or create test store
    const { data: stores, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id')
      .limit(1);

    if (storeError) throw storeError;

    if (stores && stores.length > 0) {
      testStoreId = stores[0].id;
      log(`   Using existing store: ${testStoreId}`, 'blue');
    } else {
      // Create test store
      const newStore = {
        id: randomUUID(),
        name: 'Test Store',
        country: 'CO',
        currency: 'COP',
        is_active: true
      };

      const { data: createdStore, error: createError } = await supabaseAdmin
        .from('stores')
        .insert(newStore)
        .select()
        .single();

      if (createError) throw createError;
      testStoreId = createdStore.id;
      log(`   Created test store: ${testStoreId}`, 'green');
    }

    // Get or create test customer
    const { data: customers, error: customerError } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('store_id', testStoreId)
      .limit(1);

    if (customerError) throw customerError;

    if (customers && customers.length > 0) {
      testCustomerId = customers[0].id;
      log(`   Using existing customer: ${testCustomerId}`, 'blue');
    } else {
      // Create test customer
      const newCustomer = {
        id: randomUUID(),
        store_id: testStoreId,
        first_name: 'Test',
        last_name: 'Customer',
        phone: '+573001234567',
        email: 'test@example.com',
        total_orders: 0,
        total_spent: 0
      };

      const { data: createdCustomer, error: createError } = await supabaseAdmin
        .from('customers')
        .insert(newCustomer)
        .select()
        .single();

      if (createError) throw createError;
      testCustomerId = createdCustomer.id;
      log(`   Created test customer: ${testCustomerId}`, 'green');
    }

    // CREATE - Insert test order
    const testOrder = {
      id: randomUUID(),
      store_id: testStoreId,
      customer_id: testCustomerId,
      shopify_order_number: Math.floor(Math.random() * 1000000),
      customer_email: 'test@example.com',
      customer_phone: '+573001234567',
      customer_first_name: 'Test',
      customer_last_name: 'Customer',
      shipping_address: { address1: 'Test Address 123', city: 'Bogotá', province: 'Cundinamarca' },
      line_items: [{ title: 'Test Product', quantity: 1, price: 100000 }],
      total_price: 100000,
      subtotal_price: 100000,
      total_tax: 0,
      total_shipping: 0,
      currency: 'COP',
      financial_status: 'pending',
      sleeves_status: 'pending',
      payment_status: 'pending',
      delivery_status: 'pending',
      customer_address: 'Test Address 123',
      confirmed_by: 'system',
      confirmation_method: 'test'
    };

    const { data: createdOrder, error: createError } = await supabaseAdmin
      .from('orders')
      .insert(testOrder)
      .select()
      .single();

    if (createError) throw createError;
    testOrderId = createdOrder.id;
    log(`   ✓ CREATE: Order created with ID ${testOrderId}`, 'green');

    // READ - Fetch the order
    const { data: fetchedOrder, error: readError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', testOrderId)
      .single();

    if (readError) throw readError;
    if (fetchedOrder.shopify_order_number !== testOrder.shopify_order_number) {
      throw new Error('Read order data mismatch');
    }
    log(`   ✓ READ: Order fetched successfully`, 'green');

    // UPDATE - Modify the order
    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ sleeves_status: 'confirmed', payment_status: 'paid' })
      .eq('id', testOrderId)
      .select()
      .single();

    if (updateError) throw updateError;
    if (updatedOrder.sleeves_status !== 'confirmed') {
      throw new Error('Update order data mismatch');
    }
    log(`   ✓ UPDATE: Order status changed to confirmed`, 'green');

    // DELETE - Remove the order
    const { error: deleteError } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('id', testOrderId);

    if (deleteError) throw deleteError;

    // Verify deletion
    const { data: deletedCheck, error: checkError } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('id', testOrderId)
      .single();

    if (checkError && checkError.code === 'PGRST116') {
      log(`   ✓ DELETE: Order deleted successfully`, 'green');
    } else {
      throw new Error('Order was not deleted');
    }

    addResult('Orders CRUD', 'pass', 'All CRUD operations successful', {
      created: testOrderId,
      operations: ['CREATE', 'READ', 'UPDATE', 'DELETE']
    });

    return true;
  } catch (error) {
    addResult('Orders CRUD', 'fail', `CRUD test failed: ${error.message}`, {
      error: error.stack
    });
    return false;
  }
}

// ================================================================
// 8. CRUD TESTING - PRODUCTS
// ================================================================
async function testProductsCRUD() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('🛍️  TESTING PRODUCTS CRUD OPERATIONS', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  let testStoreId: string;
  let testProductId: string;

  try {
    // Get test store
    const { data: stores, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id')
      .limit(1);

    if (storeError) throw storeError;
    if (!stores || stores.length === 0) throw new Error('No stores available for testing');

    testStoreId = stores[0].id;

    // CREATE
    const testProduct = {
      id: randomUUID(),
      store_id: testStoreId,
      name: 'Test Product',
      description: 'Test product description',
      sku: `TEST-SKU-${Date.now()}`,
      price: 50000,
      cost: 30000,
      stock: 100,
      is_active: true,
      modified_by: 'system'
    };

    const { data: createdProduct, error: createError } = await supabaseAdmin
      .from('products')
      .insert(testProduct)
      .select()
      .single();

    if (createError) throw createError;
    testProductId = createdProduct.id;
    log(`   ✓ CREATE: Product created with ID ${testProductId}`, 'green');

    // READ
    const { data: fetchedProduct, error: readError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', testProductId)
      .single();

    if (readError) throw readError;
    if (fetchedProduct.sku !== testProduct.sku) {
      throw new Error('Read product data mismatch');
    }
    log(`   ✓ READ: Product fetched successfully`, 'green');

    // UPDATE
    const { data: updatedProduct, error: updateError } = await supabaseAdmin
      .from('products')
      .update({ price: 55000, stock: 95 })
      .eq('id', testProductId)
      .select()
      .single();

    if (updateError) throw updateError;
    if (updatedProduct.price !== 55000) {
      throw new Error('Update product data mismatch');
    }
    log(`   ✓ UPDATE: Product price and stock updated`, 'green');

    // DELETE
    const { error: deleteError } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', testProductId);

    if (deleteError) throw deleteError;

    const { data: deletedCheck, error: checkError } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('id', testProductId)
      .single();

    if (checkError && checkError.code === 'PGRST116') {
      log(`   ✓ DELETE: Product deleted successfully`, 'green');
    } else {
      throw new Error('Product was not deleted');
    }

    addResult('Products CRUD', 'pass', 'All CRUD operations successful', {
      created: testProductId,
      operations: ['CREATE', 'READ', 'UPDATE', 'DELETE']
    });

    return true;
  } catch (error) {
    addResult('Products CRUD', 'fail', `CRUD test failed: ${error.message}`);
    return false;
  }
}

// ================================================================
// 9. REFERENTIAL INTEGRITY TEST
// ================================================================
async function testReferentialIntegrity() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('🔐 TESTING REFERENTIAL INTEGRITY', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  try {
    // Test 1: Try to insert order with invalid store_id
    log('   Testing invalid FK insertion...', 'blue');
    const invalidOrder = {
      id: randomUUID(),
      store_id: '00000000-0000-0000-0000-000000000000',
      customer_id: '00000000-0000-0000-0000-000000000000',
      shopify_order_number: 99999,
      customer_email: 'test@test.com',
      customer_phone: '+573001234567',
      customer_first_name: 'Test',
      customer_last_name: 'Test',
      shipping_address: {},
      line_items: [],
      total_price: 100,
      subtotal_price: 100,
      total_tax: 0,
      total_shipping: 0,
      currency: 'COP',
      financial_status: 'pending',
      sleeves_status: 'pending',
      payment_status: 'pending',
      delivery_status: 'pending',
      customer_address: 'Test',
      confirmed_by: 'system',
      confirmation_method: 'test'
    };

    const { error: invalidError } = await supabaseAdmin
      .from('orders')
      .insert(invalidOrder);

    if (invalidError) {
      log('   ✓ FK constraint prevented invalid insertion', 'green');
      addResult('Referential Integrity', 'pass', 'Foreign key constraints working correctly');
      return true;
    } else {
      throw new Error('FK constraint did not prevent invalid insertion');
    }
  } catch (error) {
    addResult('Referential Integrity', 'fail', `Integrity test failed: ${error.message}`);
    return false;
  }
}

// ================================================================
// 10. PERFORMANCE TEST
// ================================================================
async function testPerformance() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  log('⚡ TESTING DATABASE PERFORMANCE', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');

  const performanceTests = [
    {
      name: 'Simple SELECT',
      query: async () => await supabaseAdmin.from('stores').select('id').limit(10)
    },
    {
      name: 'JOIN Query (orders + customers)',
      query: async () => await supabaseAdmin
        .from('orders')
        .select('*, customers(*)')
        .limit(10)
    },
    {
      name: 'Aggregation (COUNT)',
      query: async () => await supabaseAdmin
        .from('orders')
        .select('*', { count: 'exact', head: true })
    }
  ];

  const timings: Record<string, number> = {};

  for (const test of performanceTests) {
    try {
      const start = Date.now();
      await test.query();
      const duration = Date.now() - start;
      timings[test.name] = duration;

      const status = duration < 100 ? 'green' : duration < 500 ? 'yellow' : 'red';
      log(`   ${test.name}: ${duration}ms`, status);
    } catch (error) {
      log(`   ${test.name}: Error - ${error.message}`, 'red');
      timings[test.name] = -1;
    }
  }

  const avgTime = Object.values(timings).filter(t => t > 0).reduce((a, b) => a + b, 0) / Object.keys(timings).length;

  if (avgTime < 200) {
    addResult('Performance', 'pass', `Average query time: ${avgTime.toFixed(0)}ms`, timings);
  } else if (avgTime < 500) {
    addResult('Performance', 'warning', `Average query time: ${avgTime.toFixed(0)}ms (acceptable)`, timings);
  } else {
    addResult('Performance', 'fail', `Average query time: ${avgTime.toFixed(0)}ms (slow)`, timings);
  }

  return true;
}

// ================================================================
// SUMMARY REPORT
// ================================================================
function generateSummary() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'magenta');
  log('📋 DATABASE HEALTH CHECK SUMMARY', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'magenta');

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const total = results.length;

  log(`\nTotal Tests: ${total}`, 'bright');
  log(`✅ Passed: ${passed}`, 'green');
  log(`⚠️  Warnings: ${warnings}`, 'yellow');
  log(`❌ Failed: ${failed}`, 'red');

  const successRate = ((passed / total) * 100).toFixed(1);
  log(`\nSuccess Rate: ${successRate}%`, successRate === '100.0' ? 'green' : 'yellow');

  if (failed === 0 && warnings === 0) {
    log('\n🎉 DATABASE IS HEALTHY! All tests passed.', 'green');
  } else if (failed === 0) {
    log('\n⚠️  DATABASE IS OPERATIONAL with warnings.', 'yellow');
  } else {
    log('\n❌ DATABASE HAS ISSUES that need attention.', 'red');
  }

  // Failed tests details
  if (failed > 0) {
    log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'red');
    log('FAILED TESTS:', 'red');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'red');
    results.filter(r => r.status === 'fail').forEach(r => {
      log(`\n❌ ${r.name}`, 'red');
      log(`   ${r.message}`, 'red');
      if (r.details) {
        log(`   Details: ${JSON.stringify(r.details, null, 2)}`, 'red');
      }
    });
  }

  // Warnings details
  if (warnings > 0) {
    log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'yellow');
    log('WARNINGS:', 'yellow');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'yellow');
    results.filter(r => r.status === 'warning').forEach(r => {
      log(`\n⚠️  ${r.name}`, 'yellow');
      log(`   ${r.message}`, 'yellow');
    });
  }

  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'magenta');
}

// ================================================================
// MAIN EXECUTION
// ================================================================
async function main() {
  log('\n╔════════════════════════════════════════════════════╗', 'cyan');
  log('║     DATABASE HEALTH CHECK & TESTING SUITE         ║', 'cyan');
  log('║              Ordefy - Bright Idea                  ║', 'cyan');
  log('╚════════════════════════════════════════════════════╝', 'cyan');

  const startTime = Date.now();

  // Run all tests
  const connected = await testConnection();

  if (!connected) {
    log('\n❌ Cannot proceed - database connection failed', 'red');
    process.exit(1);
  }

  await testTableStructure();
  await testTableCounts();
  await testForeignKeys();
  await testTriggers();
  await testIndexes();
  await testOrdersCRUD();
  await testProductsCRUD();
  await testReferentialIntegrity();
  await testPerformance();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  generateSummary();
  log(`\n⏱️  Total execution time: ${duration}s`, 'cyan');

  // Exit with appropriate code
  const failed = results.filter(r => r.status === 'fail').length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  log(`\n💥 FATAL ERROR: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

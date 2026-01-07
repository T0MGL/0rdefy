/**
 * Verify Order Deletion Cleanup
 *
 * This script verifies that an order was completely deleted
 * and no orphaned data remains in related tables.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyOrderCleanup(orderId) {
  console.log('🔍 Verifying deletion cleanup for order:', orderId);
  console.log('─'.repeat(60));

  const tables = [
    { name: 'orders', column: 'id' },
    { name: 'order_status_history', column: 'order_id' },
    { name: 'delivery_attempts', column: 'order_id' },
    { name: 'picking_session_orders', column: 'order_id' },
    { name: 'packing_progress', column: 'order_id' },
    { name: 'return_session_orders', column: 'order_id' },
    { name: 'settlement_orders', column: 'order_id' },
    { name: 'follow_up_log', column: 'order_id' },
    { name: 'order_line_items', column: 'order_id' }
  ];

  let totalOrphaned = 0;

  for (const table of tables) {
    try {
      const { count, error } = await supabaseAdmin
        .from(table.name)
        .select('*', { count: 'exact', head: true })
        .eq(table.column, orderId);

      if (error) {
        console.log(`⚠️  ${table.name.padEnd(30)} - Error: ${error.message}`);
        continue;
      }

      const recordCount = count || 0;
      if (recordCount > 0) {
        console.log(`❌ ${table.name.padEnd(30)} - ${recordCount} orphaned records found!`);
        totalOrphaned += recordCount;
      } else {
        console.log(`✅ ${table.name.padEnd(30)} - Clean (0 records)`);
      }
    } catch (err) {
      console.log(`⚠️  ${table.name.padEnd(30)} - Error: ${err.message}`);
    }
  }

  console.log('─'.repeat(60));

  if (totalOrphaned > 0) {
    console.log(`❌ CLEANUP FAILED: ${totalOrphaned} orphaned records found across all tables`);
    console.log('⚠️  The cascading delete trigger may not be working correctly.');
    process.exit(1);
  } else {
    console.log('✅ CLEANUP SUCCESSFUL: No orphaned data found in any table');
    console.log('🎉 The order was completely removed from the database');
  }
}

// Get order ID from command line
const orderId = process.argv[2];

if (!orderId) {
  console.error('❌ Error: Please provide an order ID');
  console.log('Usage: node scripts/verify-order-cleanup.cjs <ORDER_ID>');
  process.exit(1);
}

verifyOrderCleanup(orderId);

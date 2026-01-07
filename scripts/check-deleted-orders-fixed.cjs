/**
 * Check deleted orders status
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDeletedOrders() {
  console.log('🔍 Checking ALL soft-deleted orders in database');
  console.log('─'.repeat(60));
  console.log('');

  // Find all orders with deleted_at set (soft-deleted)
  const { data: softDeletedOrders, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, customer_first_name, customer_last_name, deleted_at, deleted_by, deletion_type, sleeves_status, created_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(20);

  if (error) {
    console.log(`❌ Error: ${error.message}`);
    return;
  }

  if (!softDeletedOrders || softDeletedOrders.length === 0) {
    console.log('✅ No soft-deleted orders found');
    console.log('   All deleted orders were properly hard-deleted!');
    console.log('');
    return;
  }

  console.log(`⚠️  Found ${softDeletedOrders.length} SOFT-DELETED orders (should be 0 if owner deleted them)`);
  console.log('');

  softDeletedOrders.forEach((order, index) => {
    console.log(`${index + 1}. Order: ${order.order_number || order.id.substring(0, 12)}`);
    console.log(`   Customer: ${order.customer_first_name} ${order.customer_last_name}`);
    console.log(`   Status: ${order.sleeves_status}`);
    console.log(`   Deleted at: ${order.deleted_at}`);
    console.log(`   Deletion type: ${order.deletion_type || 'N/A'}`);
    console.log(`   Created: ${order.created_at}`);
    console.log('');
  });

  console.log('─'.repeat(60));
  console.log('\n⚠️  PROBLEM DETECTED:');
  console.log('   These orders were soft-deleted (not hard-deleted)');
  console.log('   This means:');
  console.log('   - Migration 039 might not be applied');
  console.log('   - OR trigger is not working');
  console.log('   - OR they were deleted by non-owner');
  console.log('');
  console.log('📋 Next steps:');
  console.log('   1. Apply SQL from /tmp/grant-owner-access.sql in Supabase');
  console.log('   2. Verify migration 039 was applied (run verify-migration-039.cjs)');
  console.log('   3. As OWNER, try deleting one of these orders again');
  console.log('   4. Check if it gets hard-deleted (disappears from DB completely)');
}

checkDeletedOrders();

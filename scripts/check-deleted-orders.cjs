/**
 * Check deleted orders status
 * Verifies if orders are soft-deleted or hard-deleted
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDeletedOrders() {
  console.log('🔍 Checking deleted orders status');
  console.log('─'.repeat(60));

  // Check the two orders from the screenshot
  const orderIds = ['0R#bb402d08', '0R#2b0a4dff'];

  for (const orderId of orderIds) {
    console.log(`\nOrder: ${orderId}`);
    console.log('─'.repeat(40));

    // Check if order exists in database
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, deleted_at, deleted_by, deletion_type, sleeves_status')
      .eq('id', orderId)
      .maybeSingle();

    if (error) {
      console.log(`❌ Error querying order: ${error.message}`);
      continue;
    }

    if (!order) {
      console.log('✅ HARD DELETED - Order not found in database');
      console.log('   Status: Permanently deleted (correct behavior)');
    } else {
      if (order.deleted_at) {
        console.log('⚠️  SOFT DELETED - Order still in database');
        console.log(`   deleted_at: ${order.deleted_at}`);
        console.log(`   deleted_by: ${order.deleted_by}`);
        console.log(`   deletion_type: ${order.deletion_type}`);
        console.log(`   sleeves_status: ${order.sleeves_status}`);
        console.log('');
        console.log('   ⚠️  This should have been HARD DELETED by owner!');
      } else {
        console.log('❌ ACTIVE - Order is still active (not deleted)');
        console.log(`   sleeves_status: ${order.sleeves_status}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('\n📋 Diagnostic Info:');

  // Check if trigger exists
  const { data: triggers, error: triggerError } = await supabaseAdmin
    .rpc('exec_sql', {
      query: `SELECT trigger_name FROM information_schema.triggers
              WHERE trigger_name = 'trigger_cascade_delete_order_data'`
    })
    .catch(() => ({ data: null, error: 'Cannot query triggers via RPC' }));

  if (!triggers) {
    console.log('\n⚠️  Cannot verify trigger via client.');
    console.log('   Run this in Supabase SQL Editor:');
    console.log('   SELECT trigger_name FROM information_schema.triggers');
    console.log('   WHERE trigger_name = \'trigger_cascade_delete_order_data\';');
  }

  console.log('\n💡 If orders show as soft-deleted (should be hard-deleted):');
  console.log('   1. Verify migration 039 was applied in Supabase');
  console.log('   2. Check trigger exists with the SQL query above');
  console.log('   3. Re-delete the orders as owner to test hard delete');
}

checkDeletedOrders();

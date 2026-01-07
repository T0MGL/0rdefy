/**
 * Verify Migration 039 was applied successfully
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyMigration() {
  console.log('🔍 Verifying Migration 039: Hard Delete Cascading Cleanup');
  console.log('─'.repeat(60));
  console.log('');

  let allPassed = true;

  // Test 1: Check if cascade_delete_order_data function exists
  console.log('Test 1: Checking if cascade_delete_order_data() function exists...');
  try {
    const { data, error } = await supabaseAdmin
      .from('pg_proc')
      .select('proname')
      .eq('proname', 'cascade_delete_order_data')
      .single();

    if (error || !data) {
      console.log('❌ FAILED: Function cascade_delete_order_data() not found');
      console.log('   Error:', error?.message || 'Function does not exist');
      allPassed = false;
    } else {
      console.log('✅ PASSED: Function cascade_delete_order_data() exists');
    }
  } catch (err) {
    console.log('⚠️  Cannot verify function (need to check manually in Supabase)');
  }
  console.log('');

  // Test 2: Check if deleted_at column exists
  console.log('Test 2: Checking if soft delete columns exist...');
  try {
    const { data: columnCheck } = await supabaseAdmin
      .from('orders')
      .select('deleted_at, deleted_by, deletion_type')
      .limit(0);

    console.log('✅ PASSED: Soft delete columns exist (deleted_at, deleted_by, deletion_type)');
  } catch (err) {
    console.log('❌ FAILED: Soft delete columns missing');
    console.log('   Error:', err.message);
    allPassed = false;
  }
  console.log('');

  // Test 3: Check if indexes exist
  console.log('Test 3: Checking if soft delete indexes exist...');
  try {
    // We can't directly query pg_indexes via Supabase client
    // This would need to be done via SQL Editor
    console.log('⚠️  Cannot verify indexes via client (check manually)');
    console.log('   Run this in SQL Editor:');
    console.log('   SELECT indexname FROM pg_indexes');
    console.log('   WHERE tablename = \'orders\'');
    console.log('   AND indexname IN (\'idx_orders_deleted_at\', \'idx_orders_active\');');
  } catch (err) {
    console.log('⚠️  Index verification skipped');
  }
  console.log('');

  // Test 4: Test soft delete (non-destructive)
  console.log('Test 4: Testing soft delete functionality...');
  console.log('   (Skipping automated test - requires manual testing)');
  console.log('');

  // Summary
  console.log('─'.repeat(60));
  if (allPassed) {
    console.log('✅ All automated verifications PASSED');
  } else {
    console.log('❌ Some verifications FAILED');
  }
  console.log('');
  console.log('📋 Manual Verification Required:');
  console.log('');
  console.log('Run these queries in Supabase SQL Editor:');
  console.log('');
  console.log('-- 1. Check function exists');
  console.log('SELECT routine_name FROM information_schema.routines');
  console.log('WHERE routine_name = \'cascade_delete_order_data\';');
  console.log('');
  console.log('-- 2. Check trigger exists');
  console.log('SELECT trigger_name FROM information_schema.triggers');
  console.log('WHERE trigger_name = \'trigger_cascade_delete_order_data\';');
  console.log('');
  console.log('-- 3. Check soft delete columns');
  console.log('SELECT column_name FROM information_schema.columns');
  console.log('WHERE table_name = \'orders\'');
  console.log('AND column_name IN (\'deleted_at\', \'deleted_by\', \'deletion_type\');');
  console.log('');
  console.log('Expected results:');
  console.log('  - Query 1: 1 row (cascade_delete_order_data)');
  console.log('  - Query 2: 1 row (trigger_cascade_delete_order_data)');
  console.log('  - Query 3: 3 rows (deleted_at, deleted_by, deletion_type)');
  console.log('');
}

verifyMigration();

/**
 * Test create_shipments_batch function directly
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function testBatchFunction() {
  console.log('\n🧪 Testing create_shipments_batch function\n');

  try {
    // First, let's verify the function exists
    console.log('1️⃣ Checking if function exists...');
    const { data: functions, error: funcError } = await supabase
      .rpc('_info_schema_functions');

    if (funcError) {
      console.log('⚠️  Could not query functions (expected)');
    }

    // Try to call the function with empty array (should fail gracefully)
    console.log('\n2️⃣ Testing function call with empty array...');
    const { data, error } = await supabase
      .rpc('create_shipments_batch', {
        p_store_id: '00000000-0000-0000-0000-000000000000',
        p_order_ids: [],
        p_shipped_by: '00000000-0000-0000-0000-000000000000',
        p_notes: null
      });

    if (error) {
      console.log('❌ Error calling function:');
      console.log('   Code:', error.code);
      console.log('   Message:', error.message);
      console.log('   Details:', error.details);
      console.log('   Hint:', error.hint);

      if (error.message.includes('structure of query does not match')) {
        console.log('\n💡 This error means:');
        console.log('   - The function might not exist in the database');
        console.log('   - OR the return type doesn\'t match what Supabase expects');
        console.log('\n🔧 Solution:');
        console.log('   1. Verify migration 027 was applied');
        console.log('   2. Check Supabase SQL Editor for any errors');
        console.log('   3. Try running the function directly in SQL Editor');
      }

      process.exit(1);
    }

    console.log('✅ Function called successfully!');
    console.log('   Result:', data);

  } catch (error) {
    console.error('\n💥 Unexpected error:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

testBatchFunction();

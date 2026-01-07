/**
 * Run cleanup SQL script to delete Bright Idea orders and return sessions
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runCleanup() {
  console.log('🧹 Starting cleanup of Bright Idea data...\n');

  try {
    // Read SQL file
    const sqlPath = path.join(__dirname, 'cleanup-bright-idea-orders.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📄 Executing SQL cleanup script...\n');

    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
      // If exec_sql doesn't exist, try direct execution via REST API
      console.log('⚠️  exec_sql function not available, trying alternative method...\n');

      // Alternative: Delete via API calls
      await deleteViaApi();
    } else {
      console.log('✅ SQL script executed successfully');
      if (data) {
        console.log('Result:', data);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);

    // Fallback to API method
    console.log('\n🔄 Falling back to API deletion method...\n');
    await deleteViaApi();
  }
}

async function deleteViaApi() {
  try {
    // Get Bright Idea store
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id, name')
      .ilike('name', '%Bright%Idea%')
      .maybeSingle();

    if (storeError) {
      console.error('❌ Error finding store:', storeError.message);
      return;
    }

    if (!store) {
      console.log('ℹ️  No Bright Idea store found');
      return;
    }

    console.log(`✅ Found store: ${store.name} (${store.id})`);

    // Delete return sessions (CASCADE handles related tables)
    console.log('\n🗑️  Deleting return sessions...');
    const { error: sessionsError } = await supabase
      .from('return_sessions')
      .delete()
      .eq('store_id', store.id);

    if (sessionsError) {
      console.error('❌ Error deleting sessions:', sessionsError.message);
    } else {
      console.log('✅ Return sessions deleted');
    }

    // Get all orders for this store
    console.log('\n📊 Finding orders...');
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id')
      .eq('store_id', store.id);

    if (ordersError) {
      console.error('❌ Error finding orders:', ordersError.message);
      return;
    }

    if (!orders || orders.length === 0) {
      console.log('ℹ️  No orders found');
      return;
    }

    const orderIds = orders.map(o => o.id);
    console.log(`   Found ${orderIds.length} order(s)`);

    // Delete order line items
    console.log('\n🗑️  Deleting order line items...');
    const { error: lineItemsError } = await supabase
      .from('order_line_items')
      .delete()
      .in('order_id', orderIds);

    if (lineItemsError) {
      console.error('⚠️  Error deleting line items:', lineItemsError.message);
    } else {
      console.log('✅ Order line items deleted');
    }

    // Delete inventory movements
    console.log('\n🗑️  Deleting inventory movements...');
    const { error: movementsError } = await supabase
      .from('inventory_movements')
      .delete()
      .in('order_id', orderIds);

    if (movementsError) {
      console.error('⚠️  Error deleting inventory movements:', movementsError.message);
    } else {
      console.log('✅ Inventory movements deleted');
    }

    // Delete order status history
    console.log('\n🗑️  Deleting order status history...');
    const { error: historyError } = await supabase
      .from('order_status_history')
      .delete()
      .in('order_id', orderIds);

    if (historyError) {
      console.error('⚠️  Error deleting status history:', historyError.message);
    } else {
      console.log('✅ Order status history deleted');
    }

    // Finally, delete orders
    console.log('\n🗑️  Deleting orders...');
    const { error: deleteOrdersError } = await supabase
      .from('orders')
      .delete()
      .eq('store_id', store.id);

    if (deleteOrdersError) {
      console.error('❌ Error deleting orders:', deleteOrdersError.message);
      console.error('   You may need to manually check for other FK constraints');
    } else {
      console.log(`✅ Deleted ${orderIds.length} order(s)`);
    }

    console.log('\n✨ Cleanup completed!');

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    throw error;
  }
}

// Run
runCleanup()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

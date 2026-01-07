/**
 * Force delete orders by first canceling them to restore stock
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function forceDelete() {
  console.log('🔨 Force deleting Bright Idea orders...\n');

  try {
    // Get Bright Idea store
    const { data: store } = await supabase
      .from('stores')
      .select('id, name')
      .ilike('name', '%Bright%Idea%')
      .maybeSingle();

    if (!store) {
      console.log('ℹ️  No Bright Idea store found');
      return;
    }

    console.log(`✅ Found store: ${store.name}`);

    // Get all orders
    const { data: orders } = await supabase
      .from('orders')
      .select('id, shopify_order_number, sleeves_status')
      .eq('store_id', store.id);

    if (!orders || orders.length === 0) {
      console.log('ℹ️  No orders found');
      return;
    }

    console.log(`📦 Found ${orders.length} order(s):\n`);
    orders.forEach(o => {
      console.log(`   - ${o.shopify_order_number || o.id.slice(0, 8)} (${o.sleeves_status})`);
    });

    // Step 1: Cancel all orders to restore stock
    console.log('\n🔄 Canceling orders to restore stock...');
    for (const order of orders) {
      const { error } = await supabase
        .from('orders')
        .update({
          sleeves_status: 'cancelled',
          delivery_status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', order.id);

      if (error) {
        console.error(`   ❌ Error canceling ${order.id}:`, error.message);
      } else {
        console.log(`   ✅ Canceled order ${order.shopify_order_number || order.id.slice(0, 8)}`);
      }
    }

    // Wait a moment for triggers to process
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 2: Now delete related data
    const orderIds = orders.map(o => o.id);

    console.log('\n🗑️  Deleting order line items...');
    await supabase
      .from('order_line_items')
      .delete()
      .in('order_id', orderIds);
    console.log('✅ Deleted');

    console.log('\n🗑️  Deleting inventory movements...');
    await supabase
      .from('inventory_movements')
      .delete()
      .in('order_id', orderIds);
    console.log('✅ Deleted');

    console.log('\n🗑️  Deleting order status history...');
    await supabase
      .from('order_status_history')
      .delete()
      .in('order_id', orderIds);
    console.log('✅ Deleted');

    console.log('\n🗑️  Deleting follow-up logs...');
    await supabase
      .from('follow_up_log')
      .delete()
      .in('order_id', orderIds);
    console.log('✅ Deleted');

    console.log('\n🗑️  Deleting delivery attempts...');
    await supabase
      .from('delivery_attempts')
      .delete()
      .in('order_id', orderIds);
    console.log('✅ Deleted');

    // Step 3: Try to delete orders again
    console.log('\n🗑️  Deleting orders...');
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('store_id', store.id);

    if (deleteError) {
      console.error('❌ Error:', deleteError.message);
      console.log('\n⚠️  Some orders could not be deleted. Checking remaining constraints...');

      // Check what's left
      const { data: remaining } = await supabase
        .from('orders')
        .select('id, shopify_order_number')
        .eq('store_id', store.id);

      if (remaining && remaining.length > 0) {
        console.log(`\n📋 Remaining orders (${remaining.length}):`);
        remaining.forEach(o => {
          console.log(`   - ${o.shopify_order_number || o.id}`);
        });
      }
    } else {
      console.log(`✅ Deleted ${orders.length} order(s)`);
    }

    // Also delete return sessions
    console.log('\n🗑️  Deleting return sessions...');
    await supabase
      .from('return_sessions')
      .delete()
      .eq('store_id', store.id);
    console.log('✅ Deleted');

    console.log('\n✨ Cleanup completed!');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

forceDelete()
  .then(() => {
    console.log('\n✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

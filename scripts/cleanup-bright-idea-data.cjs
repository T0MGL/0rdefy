/**
 * Cleanup Script: Delete Bright Idea orders and return sessions
 *
 * This script deletes:
 * 1. All return sessions for Bright Idea store
 * 2. All orders for Bright Idea store
 *
 * Usage: node scripts/cleanup-bright-idea-data.cjs
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanup() {
  console.log('🧹 Starting cleanup of Bright Idea data...\n');

  try {
    // Step 1: Find Bright Idea store
    console.log('📍 Finding Bright Idea store...');
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id, name')
      .eq('name', 'Bright Idea')
      .single();

    if (storeError) {
      console.error('❌ Error finding store:', storeError.message);
      process.exit(1);
    }

    if (!store) {
      console.log('ℹ️  No store found with name "Bright Idea"');
      return;
    }

    console.log(`✅ Found store: ${store.name} (${store.id})\n`);

    // Step 2: Delete return sessions
    console.log('🗑️  Deleting return sessions...');
    const { data: sessions, error: sessionsError } = await supabase
      .from('return_sessions')
      .select('id, session_code')
      .eq('store_id', store.id);

    if (sessionsError) {
      console.error('❌ Error fetching return sessions:', sessionsError.message);
    } else if (sessions && sessions.length > 0) {
      console.log(`   Found ${sessions.length} return session(s):`);
      sessions.forEach(s => console.log(`   - ${s.session_code}`));

      const { error: deleteSessionsError } = await supabase
        .from('return_sessions')
        .delete()
        .eq('store_id', store.id);

      if (deleteSessionsError) {
        console.error('❌ Error deleting return sessions:', deleteSessionsError.message);
      } else {
        console.log(`✅ Deleted ${sessions.length} return session(s)\n`);
      }
    } else {
      console.log('   No return sessions found\n');
    }

    // Step 3: Get orders count
    console.log('📊 Counting orders...');
    const { count: ordersCount, error: countError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store.id);

    if (countError) {
      console.error('❌ Error counting orders:', countError.message);
    } else {
      console.log(`   Found ${ordersCount} order(s)\n`);
    }

    // Step 4: Delete order line items first (FK constraint)
    console.log('🗑️  Deleting order line items...');
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('store_id', store.id);

    if (orders && orders.length > 0) {
      const orderIds = orders.map(o => o.id);

      const { error: deleteLineItemsError } = await supabase
        .from('order_line_items')
        .delete()
        .in('order_id', orderIds);

      if (deleteLineItemsError) {
        console.error('❌ Error deleting order line items:', deleteLineItemsError.message);
      } else {
        console.log('✅ Deleted order line items\n');
      }
    }

    // Step 5: Delete orders
    console.log('🗑️  Deleting orders...');
    const { error: deleteOrdersError } = await supabase
      .from('orders')
      .delete()
      .eq('store_id', store.id);

    if (deleteOrdersError) {
      console.error('❌ Error deleting orders:', deleteOrdersError.message);
      console.error('   This might be due to foreign key constraints.');
      console.error('   You may need to manually delete related records first.');
    } else {
      console.log(`✅ Deleted ${ordersCount} order(s)\n`);
    }

    console.log('✨ Cleanup completed!');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Run cleanup
cleanup()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

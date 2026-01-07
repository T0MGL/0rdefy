/**
 * Verify that Bright Idea orders and return sessions were deleted
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function verify() {
  console.log('🔍 Verifying cleanup...\n');

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

    console.log(`Store: ${store.name} (${store.id})\n`);

    // Check orders
    const { count: ordersCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store.id);

    console.log(`📦 Orders: ${ordersCount || 0}`);

    // Check return sessions
    const { count: sessionsCount } = await supabase
      .from('return_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store.id);

    console.log(`🔄 Return sessions: ${sessionsCount || 0}`);

    // Check order line items
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('store_id', store.id);

    if (orders && orders.length > 0) {
      const orderIds = orders.map(o => o.id);

      const { count: lineItemsCount } = await supabase
        .from('order_line_items')
        .select('*', { count: 'exact', head: true })
        .in('order_id', orderIds);

      console.log(`📋 Order line items: ${lineItemsCount || 0}`);

      const { count: movementsCount } = await supabase
        .from('inventory_movements')
        .select('*', { count: 'exact', head: true })
        .in('order_id', orderIds);

      console.log(`📊 Inventory movements: ${movementsCount || 0}`);
    } else {
      console.log(`📋 Order line items: 0`);
      console.log(`📊 Inventory movements: 0`);
    }

    console.log('\n✅ Verification complete');

    if (ordersCount === 0 && sessionsCount === 0) {
      console.log('✨ All Bright Idea data has been successfully deleted!');
    } else {
      console.log('⚠️  Some data still remains');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

verify()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

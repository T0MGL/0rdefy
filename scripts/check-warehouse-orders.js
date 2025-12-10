/**
 * Script to verify orders available for warehouse
 * Checks orders in 'confirmed' status
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkWarehouseOrders() {
  console.log('🔍 Checking warehouse orders...\n');

  try {
    // Get all orders and their statuses
    const { data: allOrders, error: allError } = await supabase
      .from('orders')
      .select('id, shopify_order_number, sleeves_status, store_id, customer_first_name, customer_last_name')
      .order('created_at', { ascending: false })
      .limit(50);

    if (allError) {
      console.error('❌ Error fetching all orders:', allError);
      return;
    }

    console.log(`📦 Total orders (last 50): ${allOrders?.length || 0}`);

    // Group by status
    const byStatus = {};
    allOrders?.forEach(order => {
      const status = order.sleeves_status || 'unknown';
      if (!byStatus[status]) {
        byStatus[status] = [];
      }
      byStatus[status].push(order);
    });

    console.log('\n📊 Orders by status:');
    Object.entries(byStatus).forEach(([status, orders]) => {
      console.log(`  ${status}: ${orders.length}`);
      if (status === 'confirmed') {
        console.log('    📋 Confirmed orders:');
        orders.forEach(o => {
          console.log(`      - ${o.shopify_order_number || o.id.slice(0, 8)} (${o.customer_first_name} ${o.customer_last_name})`);
        });
      }
    });

    // Now check what the warehouse endpoint would see
    console.log('\n🏭 Checking warehouse endpoint query...');

    // Get unique store IDs
    const storeIds = [...new Set(allOrders?.map(o => o.store_id))];
    console.log(`\n🏪 Store IDs found: ${storeIds.length}`);

    for (const storeId of storeIds) {
      const { data: confirmedOrders, error: confirmedError } = await supabase
        .from('orders')
        .select(`
          id,
          shopify_order_number,
          customer_first_name,
          customer_last_name,
          customer_phone,
          created_at,
          line_items,
          carriers!courier_id (name)
        `)
        .eq('store_id', storeId)
        .eq('sleeves_status', 'confirmed')
        .order('created_at', { ascending: false });

      if (confirmedError) {
        console.error(`❌ Error fetching confirmed orders for store ${storeId}:`, confirmedError);
        continue;
      }

      console.log(`\n  Store ${storeId.slice(0, 8)}:`);
      console.log(`    Confirmed orders ready for warehouse: ${confirmedOrders?.length || 0}`);

      if (confirmedOrders && confirmedOrders.length > 0) {
        confirmedOrders.forEach(order => {
          const totalItems = Array.isArray(order.line_items)
            ? order.line_items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0)
            : 0;
          console.log(`      ✅ ${order.shopify_order_number || order.id.slice(0, 8)} - ${order.customer_first_name} ${order.customer_last_name} (${totalItems} items)`);
        });
      } else {
        console.log('      ⚠️  No confirmed orders found for warehouse');
      }
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkWarehouseOrders()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });

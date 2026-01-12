/**
 * Script: delete-behipnos-orders.ts
 * Delete all orders for BeHipnos store
 */

import { supabaseAdmin } from '../db/connection';

const STORE_ID = 'dba0c44d-85ba-42fc-9375-a1d4ffc9ced4';

async function deleteAllOrders() {
  console.log('🗑️  Deleting all orders for BeHipnos...\n');

  // Get all order IDs
  const { data: orders, error: fetchError } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('store_id', STORE_ID);

  if (fetchError) {
    console.log('Error fetching:', fetchError.message);
    return;
  }

  console.log('Total orders to delete:', orders?.length || 0);

  if (!orders || orders.length === 0) {
    console.log('No orders to delete');
    return;
  }

  const orderIds = orders.map(o => o.id);

  // Delete dependencies first
  const tables = [
    'order_line_items',
    'order_status_history',
    'follow_up_log',
    'delivery_attempts',
    'inventory_movements',
    'settlement_orders',
    'dispatch_session_orders',
    'picking_session_orders',
    'packing_progress',
    'return_session_orders'
  ];

  for (const table of tables) {
    console.log(`Deleting ${table}...`);
    const { error } = await supabaseAdmin.from(table).delete().in('order_id', orderIds);
    console.log(error ? `   Error: ${error.message}` : '   Done');
  }

  // Now delete orders one by one
  console.log('\nDeleting orders...');
  let deleted = 0;
  const errors: string[] = [];

  for (const orderId of orderIds) {
    const { error } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (error) {
      errors.push(`${orderId}: ${error.message}`);
    } else {
      deleted++;
    }
  }

  console.log(`   Deleted: ${deleted}`);
  if (errors.length > 0) {
    console.log(`   Errors: ${errors.length}`);
    console.log('   First error:', errors[0]);
  }

  // Verify
  const { count } = await supabaseAdmin
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', STORE_ID);

  console.log('\n✅ Remaining orders:', count);
}

deleteAllOrders().then(() => process.exit(0)).catch(e => {
  console.error('Error:', e);
  process.exit(1);
});

/**
 * Diagnostic Script: Check for order ID corruption
 * This script checks if there are orders with non-UUID ids in the database
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnoseOrderIds() {
  console.log('🔍 Checking for order ID issues...\n');

  // Get all orders (any status)
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, shopify_order_id, shopify_order_number, customer_first_name, customer_last_name, sleeves_status')
    .order('created_at', { ascending: false})
    .limit(50);

  if (error) {
    console.error('❌ Error fetching orders:', error);
    return;
  }

  console.log(`📊 Found ${orders?.length || 0} orders (all statuses)\n`);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let corruptedCount = 0;
  let validCount = 0;

  orders?.forEach((order, index) => {
    const isValidUUID = uuidRegex.test(order.id);
    const status = isValidUUID ? '✅' : '❌';

    if (!isValidUUID) {
      corruptedCount++;
      console.log(`${status} Order ${index + 1}:`);
      console.log(`   ID: ${order.id} (CORRUPTED - should be UUID)`);
      console.log(`   Shopify Order ID: ${order.shopify_order_id}`);
      console.log(`   Order Number: ${order.shopify_order_number}`);
      console.log(`   Customer: ${order.customer_first_name} ${order.customer_last_name}`);
      console.log('');
    } else {
      validCount++;
      console.log(`${status} Order ${index + 1}: ${order.id.substring(0, 8)}... (${order.shopify_order_number || 'No number'})`);
    }
  });

  console.log('\n📈 Summary:');
  console.log(`   ✅ Valid UUIDs: ${validCount}`);
  console.log(`   ❌ Corrupted IDs: ${corruptedCount}`);

  if (corruptedCount > 0) {
    console.log('\n⚠️  WARNING: Data corruption detected!');
    console.log('   Some orders have Shopify order IDs in the `id` column instead of UUIDs.');
    console.log('   This will cause errors when creating warehouse sessions.');
    console.log('\n   Recommended action: Recreate these orders with proper UUIDs.');
  } else {
    console.log('\n✅ All orders have valid UUID ids!');
  }
}

diagnoseOrderIds()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

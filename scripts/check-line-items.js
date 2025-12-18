import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLineItems() {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, shopify_order_number, line_items')
    .limit(5);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Checking line_items structure:\n');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  orders.forEach((order, index) => {
    console.log(`Order ${index + 1}: ${order.shopify_order_number || order.id.substring(0, 8)}`);

    if (Array.isArray(order.line_items)) {
      order.line_items.forEach((item, itemIdx) => {
        const productId = item.product_id;
        const isValidUUID = productId ? uuidRegex.test(productId) : false;

        console.log(`  Item ${itemIdx + 1}:`);
        console.log(`    product_id: ${productId || 'NULL'} ${isValidUUID ? '✅ UUID' : '❌ NOT UUID'}`);
        console.log(`    quantity: ${item.quantity}`);
        console.log(`    name: ${item.name || item.product_name || 'N/A'}`);
      });
    } else {
      console.log('  ⚠️  line_items is not an array or is null');
    }
    console.log('---\n');
  });
}

checkLineItems()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

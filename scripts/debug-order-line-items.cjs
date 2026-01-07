require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugOrderLineItems() {
  try {
    // Find all confirmed orders
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('id, shopify_order_number, line_items, sleeves_status')
      .eq('sleeves_status', 'confirmed')
      .limit(5);

    if (orderError) {
      console.error('Error fetching orders:', orderError);
      return;
    }

    if (!orders || orders.length === 0) {
      console.log('❌ No confirmed orders found');
      return;
    }

    console.log(`\n✅ Found ${orders.length} confirmed orders\n`);

    for (const order of orders) {
      console.log('━'.repeat(60));
      console.log('📦 ORDER:', order.shopify_order_number || order.id.slice(0, 8));
      console.log('   Status:', order.sleeves_status);
      console.log('\n📋 line_items (JSONB):');
      console.log('   ', JSON.stringify(order.line_items).slice(0, 200) + '...');

      // Check order_line_items table
      const { data: lineItems, error: lineItemsError } = await supabase
        .from('order_line_items')
        .select('*')
        .eq('order_id', order.id);

      if (lineItemsError) {
        console.error('   Error fetching line items:', lineItemsError);
        continue;
      }

      console.log('\n📊 order_line_items (normalized):', lineItems?.length || 0, 'items');

      if (!lineItems || lineItems.length === 0) {
        console.log('   ❌ NO LINE ITEMS FOUND IN order_line_items TABLE!');
        console.log('   → This order will fail when creating picking session');
      } else {
        // Check for product mapping
        const unmappedItems = lineItems.filter(item => !item.product_id);
        if (unmappedItems.length > 0) {
          console.log(`\n   ⚠️  ${unmappedItems.length} items WITHOUT product_id mapping:`);
          unmappedItems.forEach(item => {
            console.log(`      - ${item.product_name} (Shopify: ${item.shopify_product_id})`);
          });
        } else {
          console.log('   ✅ All items have product_id mapping');
        }
      }
      console.log('');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

debugOrderLineItems();

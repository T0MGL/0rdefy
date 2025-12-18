import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkOrderLineItemsTable() {
  console.log('🔍 Checking order_line_items table...\n');

  // Check if table exists and get some data
  const { data: lineItems, error } = await supabase
    .from('order_line_items')
    .select('*')
    .limit(10);

  if (error) {
    console.error('❌ Error accessing order_line_items table:', error.message);
    console.log('\n⚠️  The table might not exist or might be empty.');
    return;
  }

  if (!lineItems || lineItems.length === 0) {
    console.log('⚠️  order_line_items table exists but is EMPTY');
    console.log('   This means Shopify orders have not been normalized yet.');
    return;
  }

  console.log(`✅ Found ${lineItems.length} line items in order_line_items table\n`);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  lineItems.forEach((item, index) => {
    const productIdValid = item.product_id ? uuidRegex.test(item.product_id) : false;

    console.log(`Line Item ${index + 1}:`);
    console.log(`  Order ID: ${item.order_id}`);
    console.log(`  Product ID: ${item.product_id || 'NULL'} ${productIdValid ? '✅ UUID' : '❌ NOT UUID'}`);
    console.log(`  Shopify Product ID: ${item.shopify_product_id || 'N/A'}`);
    console.log(`  Shopify Variant ID: ${item.shopify_variant_id || 'N/A'}`);
    console.log(`  Quantity: ${item.quantity}`);
    console.log(`  Product Name: ${item.product_name || 'N/A'}`);
    console.log('---');
  });
}

checkOrderLineItemsTable()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkProductMapping() {
  console.log('🔍 Checking product mapping...\n');

  // Get unique Shopify product IDs from line items
  const { data: lineItems } = await supabase
    .from('order_line_items')
    .select('shopify_product_id, shopify_variant_id')
    .not('shopify_product_id', 'is', null);

  const shopifyProductIds = [...new Set(lineItems?.map(item => item.shopify_product_id) || [])];

  console.log(`Found ${shopifyProductIds.length} unique Shopify product IDs in line items\n`);

  // Check if we have local products for these
  for (const shopifyId of shopifyProductIds) {
    const { data: product } = await supabase
      .from('products')
      .select('id, name, sku, shopify_product_id, shopify_variant_id')
      .eq('shopify_product_id', shopifyId.toString())
      .maybeSingle();

    if (product) {
      console.log(`✅ Shopify Product ${shopifyId}:`);
      console.log(`   Local UUID: ${product.id}`);
      console.log(`   Name: ${product.name}`);
      console.log(`   SKU: ${product.sku || 'N/A'}`);
    } else {
      console.log(`❌ Shopify Product ${shopifyId}: NO LOCAL PRODUCT FOUND`);
    }
  }

  console.log('\n📊 Summary:');
  const { data: totalProducts } = await supabase
    .from('products')
    .select('id, shopify_product_id')
    .not('shopify_product_id', 'is', null);

  console.log(`   Total products in database: ${totalProducts?.length || 0}`);
  console.log(`   Products with Shopify mapping: ${totalProducts?.filter(p => p.shopify_product_id).length || 0}`);
}

checkProductMapping()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkOrder() {
  // Get integration first
  const { data: integration } = await supabase
    .from('shopify_integrations')
    .select('store_id, shop_domain')
    .eq('shop_domain', 's17fez-rb.myshopify.com')
    .single();

  if (!integration) {
    console.log('❌ Integration not found');
    return;
  }

  console.log(`\n🏪 Store ID: ${integration.store_id}\n`);

  // Check for recent orders
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, shopify_order_id, shopify_order_number, sleeves_status, financial_status, fulfillment_status, total_price, customer_id, created_at')
    .eq('store_id', integration.store_id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log('❌ No orders found for this store');
    return;
  }

  console.log(`📦 Recent orders:\n`);
  for (const order of orders) {
    console.log(`Order ID: ${order.id}`);
    console.log(`  Shopify Order ID: ${order.shopify_order_id}`);
    console.log(`  Shopify Order #: ${order.shopify_order_number}`);
    console.log(`  Sleeves Status: ${order.sleeves_status}`);
    console.log(`  Financial Status: ${order.financial_status}`);
    console.log(`  Fulfillment Status: ${order.fulfillment_status || 'N/A'}`);
    console.log(`  Total: $${order.total_price}`);
    console.log(`  Customer ID: ${order.customer_id || 'N/A'}`);
    console.log(`  Created: ${order.created_at}`);
    console.log('');
  }

  // Check for Shopify order ID 6938797637825 (from logs)
  const { data: specificOrder } = await supabase
    .from('orders')
    .select('*, order_line_items(*)')
    .eq('shopify_order_id', '6938797637825')
    .eq('store_id', integration.store_id)
    .single();

  if (specificOrder) {
    console.log('\n✅ FOUND THE ORDER FROM THE WEBHOOK:\n');
    console.log(JSON.stringify(specificOrder, null, 2));
  } else {
    console.log('\n❌ Order 6938797637825 NOT FOUND in database');
  }
}

checkOrder().catch(console.error);

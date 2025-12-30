#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('📦 Fetching recent Shopify webhook events...\n');

  // Get recent webhook events
  const { data: events, error } = await supabase
    .from('shopify_webhook_events')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!events || events.length === 0) {
    console.log('❌ No webhook events found');
    return;
  }

  console.log(`Found ${events.length} recent webhooks:\n`);

  for (const event of events) {
    console.log(`\nWebhook ID: ${event.id}`);
    console.log(`  Topic: ${event.topic}`);
    console.log(`  Shop: ${event.shop_domain}`);
    console.log(`  Shopify Order ID: ${event.shopify_order_id || 'N/A'}`);
    console.log(`  Status: ${event.status}`);
    console.log(`  Processed: ${event.processed ? 'Yes' : 'No'}`);
    console.log(`  Received: ${event.received_at}`);
    console.log(`  Processed: ${event.processed_at || 'N/A'}`);
    if (event.error_message) {
      console.log(`  ❌ Error: ${event.error_message}`);
    }
  }

  // Check for order 6938797637825
  console.log('\n\n🔍 Searching for order 6938797637825 specifically...\n');

  const { data: specificEvent } = await supabase
    .from('shopify_webhook_events')
    .select('*')
    .eq('shopify_order_id', '6938797637825')
    .single();

  if (specificEvent) {
    console.log('✅ FOUND webhook event for order 6938797637825:');
    console.log(JSON.stringify(specificEvent, null, 2));
  } else {
    console.log('❌ No webhook event found for order 6938797637825');
  }
}

main().catch(console.error);

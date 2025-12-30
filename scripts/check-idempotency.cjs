#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('🔍 Checking webhook idempotency keys...\n');

  const { data: keys, error } = await supabase
    .from('shopify_webhook_idempotency')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!keys || keys.length === 0) {
    console.log('ℹ️  No idempotency keys found');
    return;
  }

  console.log(`Found ${keys.length} idempotency keys:\n`);

  for (const key of keys) {
    console.log(`\nKey: ${key.idempotency_key}`);
    console.log(`  Topic: ${key.topic}`);
    console.log(`  Shopify Order ID: ${key.shopify_order_id || 'N/A'}`);
    console.log(`  Created: ${key.created_at}`);
    console.log(`  Expires: ${key.expires_at}`);
  }

  // Check for order 6938797637825
  console.log('\n\n🔍 Searching for order 6938797637825 specifically...\n');

  const { data: specificKey } = await supabase
    .from('shopify_webhook_idempotency')
    .select('*')
    .eq('shopify_order_id', '6938797637825')
    .single();

  if (specificKey) {
    console.log('✅ FOUND idempotency key for order 6938797637825:');
    console.log(JSON.stringify(specificKey, null, 2));
  } else {
    console.log('❌ No idempotency key found for order 6938797637825');
  }
}

main().catch(console.error);

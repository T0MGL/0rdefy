#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('📦 Checking webhook retry queue...\n');

  const { data: webhooks, error } = await supabase
    .from('shopify_webhook_retry_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!webhooks || webhooks.length === 0) {
    console.log('ℹ️  Queue is empty (no webhooks)');
    return;
  }

  console.log(`Found ${webhooks.length} webhooks in queue:\n`);

  for (const webhook of webhooks) {
    console.log(`\nWebhook ID: ${webhook.id}`);
    console.log(`  Topic: ${webhook.topic}`);
    console.log(`  Shop: ${webhook.shop_domain}`);
    console.log(`  Status: ${webhook.status}`);
    console.log(`  Attempt: ${webhook.attempt_count}`);
    console.log(`  Created: ${webhook.created_at}`);
    if (webhook.last_error) {
      console.log(`  ❌ Last Error: ${webhook.last_error}`);
    }
    if (webhook.next_retry_at) {
      console.log(`  Next Retry: ${webhook.next_retry_at}`);
    }
  }
}

main().catch(console.error);

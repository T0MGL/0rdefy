#!/usr/bin/env node
// Fix webhooks: Delete incorrect URLs and keep only /api/shopify/webhook/*
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// CORRECT webhook URLs (what the server actually responds to)
const CORRECT_WEBHOOKS = {
  'orders/create': 'https://api.ordefy.io/api/shopify/webhook/orders-create',
  'orders/updated': 'https://api.ordefy.io/api/shopify/webhook/orders-updated',
  'products/create': 'https://api.ordefy.io/api/shopify/webhook/products-create',
  'products/update': 'https://api.ordefy.io/api/shopify/webhook/products-update',
  'products/delete': 'https://api.ordefy.io/api/shopify/webhook/products-delete',
  'customers/create': 'https://api.ordefy.io/api/shopify/webhook/customers-create',
  'customers/update': 'https://api.ordefy.io/api/shopify/webhook/customers-update',
  'app/uninstalled': 'https://api.ordefy.io/api/shopify/webhook/app-uninstalled'
};

async function getWebhooks(shopDomain, accessToken) {
  const response = await fetch(`https://${shopDomain}/admin/api/2024-10/webhooks.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken }
  });
  const data = await response.json();
  return data.webhooks || [];
}

async function deleteWebhook(shopDomain, accessToken, webhookId) {
  const response = await fetch(
    `https://${shopDomain}/admin/api/2024-10/webhooks/${webhookId}.json`,
    {
      method: 'DELETE',
      headers: { 'X-Shopify-Access-Token': accessToken }
    }
  );
  return response.ok;
}

async function createWebhook(shopDomain, accessToken, topic, address) {
  const response = await fetch(`https://${shopDomain}/admin/api/2024-10/webhooks.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({
      webhook: { topic, address, format: 'json' }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return await response.json();
}

async function fixWebhooksForStore(integration) {
  console.log(`\n📦 Fixing webhooks for: ${integration.shop_domain}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Get current webhooks
  console.log('\n📋 Getting current webhooks...');
  const webhooks = await getWebhooks(integration.shop_domain, integration.access_token);
  console.log(`   Found ${webhooks.length} webhook(s)`);

  // 2. Delete ALL existing webhooks
  console.log('\n🗑️  Deleting all existing webhooks...');
  for (const wh of webhooks) {
    console.log(`   Deleting: ${wh.topic} → ${wh.address}`);
    await deleteWebhook(integration.shop_domain, integration.access_token, wh.id);
    await new Promise(resolve => setTimeout(resolve, 300)); // Rate limiting
  }

  // 3. Create webhooks with CORRECT URLs
  console.log('\n✨ Creating webhooks with correct URLs...');
  let successCount = 0;
  let errorCount = 0;

  for (const [topic, address] of Object.entries(CORRECT_WEBHOOKS)) {
    try {
      const result = await createWebhook(
        integration.shop_domain,
        integration.access_token,
        topic,
        address
      );
      console.log(`   ✅ ${topic} → ${address}`);

      // Save to database
      await supabase.from('shopify_webhooks').upsert({
        integration_id: integration.id,
        shopify_webhook_id: result.webhook.id.toString(),
        topic: topic,
        address: address,
        is_active: true
      });

      successCount++;
    } catch (error) {
      console.log(`   ❌ ${topic} - ${error.message}`);
      errorCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
  }

  console.log(`\n📊 Summary: ${successCount} created, ${errorCount} failed`);
}

async function main() {
  console.log('🔧 SHOPIFY WEBHOOKS FIX');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('This will delete ALL webhooks and recreate them with correct URLs');
  console.log('');
  console.log('✅ CORRECT URLs: /api/shopify/webhook/*');
  console.log('❌ WRONG URLs:   /api/webhook/* (will be deleted)');
  console.log('');

  const { data: integrations } = await supabase
    .from('shopify_integrations')
    .select('*')
    .eq('status', 'active');

  if (!integrations || integrations.length === 0) {
    console.log('⚠️  No active integrations found');
    return;
  }

  console.log(`Found ${integrations.length} active integration(s)\n`);

  for (const integration of integrations) {
    await fixWebhooksForStore(integration);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Webhook fix complete!');
  console.log('\n📋 Webhooks are now configured to:');
  console.log('   https://api.ordefy.io/api/shopify/webhook/*');
  console.log('\n🧪 Test by creating an order in Shopify');
}

main().catch(console.error);

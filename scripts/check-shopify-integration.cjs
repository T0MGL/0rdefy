#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkIntegration() {
  console.log('🔍 Checking Shopify integration for s17fez-rb.myshopify.com...\n');

  const { data, error } = await supabase
    .from('shopify_integrations')
    .select('*')
    .eq('shop_domain', 's17fez-rb.myshopify.com')
    .single();

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('📋 Integration Details:');
  console.log('  ID:', data.id);
  console.log('  Store ID:', data.store_id);
  console.log('  Shop Domain:', data.shop_domain);
  console.log('  Shop:', data.shop);
  console.log('  Status:', data.status);
  console.log('\n🔑 Credentials:');
  console.log('  API Key:', data.api_key ? `${data.api_key.substring(0, 10)}...` : 'NULL');
  console.log('  API Secret Key:', data.api_secret_key ? `${data.api_secret_key.substring(0, 10)}...` : 'NULL');
  console.log('  Access Token:', data.access_token ? `${data.access_token.substring(0, 10)}...` : 'NULL');
  console.log('  Webhook Signature:', data.webhook_signature ? `${data.webhook_signature.substring(0, 10)}...` : 'NULL');
  console.log('  Scope:', data.scope || 'NULL');
  console.log('\n🔧 Integration Type:');

  const isOAuth = data.scope && data.scope.trim() !== '';
  console.log('  OAuth Integration:', isOAuth ? 'YES ✅' : 'NO');
  console.log('  Custom App:', !isOAuth ? 'YES ✅' : 'NO');

  console.log('\n🎯 Which secret should be used for HMAC?');
  if (isOAuth) {
    console.log('  → SHOPIFY_API_SECRET from .env (OAuth Public App)');
    console.log('  → Value from .env:', process.env.SHOPIFY_API_SECRET ? `${process.env.SHOPIFY_API_SECRET.substring(0, 10)}...` : 'NOT SET');
  } else {
    console.log('  → api_secret_key from database (Custom App)');
    console.log('  → Value:', data.api_secret_key ? `${data.api_secret_key.substring(0, 10)}...` : 'NULL');
  }
}

checkIntegration().then(() => process.exit(0));

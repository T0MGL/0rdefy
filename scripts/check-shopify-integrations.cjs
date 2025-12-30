#!/usr/bin/env node
/**
 * Script temporal para verificar integraciones de Shopify
 * Identifica problemas con HMAC secret keys
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

// Load .env from root directory
dotenv.config({ path: require('path').join(__dirname, '..', '.env') });

// Initialize Supabase Admin Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables!');
  console.error('SUPABASE_URL:', supabaseUrl ? '✅' : '❌');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✅' : '❌');
  console.error('\nMake sure api/.env file exists with these variables.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function checkIntegrations() {
  console.log('\n=== SHOPIFY INTEGRATIONS DIAGNOSIS ===\n');

  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .select('id, shop_domain, shop, user_id, api_key, api_secret_key, access_token, scope, created_at')
    .order('created_at');

  if (error) {
    console.error('❌ Error fetching integrations:', error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('⚠️  No integrations found');
    process.exit(0);
  }

  data.forEach((int, index) => {
    console.log(`\n📦 Integration ${index + 1}:`);
    console.log('─'.repeat(60));
    console.log('Shop Domain:', int.shop_domain);
    console.log('Shop (short):', int.shop || '❌ MISSING');
    console.log('User ID:', int.user_id || '❌ MISSING');
    console.log('');

    // Determine integration type
    const isOAuth = !!int.scope;
    const isCustomApp = !!int.api_key;

    console.log('Type:', isOAuth ? '🔐 OAuth App' : '🔧 Custom App (Manual)');
    console.log('');

    // Check OAuth fields
    if (isOAuth) {
      console.log('OAuth Fields:');
      console.log('  ✅ Scope:', int.scope ? 'Present' : '❌ Missing');
      console.log('  ✅ Access Token:', int.access_token ? `${int.access_token.substring(0, 15)}...` : '❌ Missing');
    }

    // Check Custom App fields
    if (isCustomApp) {
      console.log('Custom App Fields:');
      console.log('  API Key:', int.api_key ? `${int.api_key.substring(0, 15)}...` : '❌ Missing');
      console.log('  API Secret Key:', int.api_secret_key ? `${int.api_secret_key.substring(0, 10)}...` : '❌ MISSING - CRITICAL!');
      console.log('  Access Token:', int.access_token ? `${int.access_token.substring(0, 15)}...` : '❌ Missing');

      // Check if API Secret Key looks valid
      if (int.api_secret_key) {
        const startsWithShpss = int.api_secret_key.startsWith('shpss_');
        console.log('  Secret Format:', startsWithShpss ? '✅ Valid (shpss_...)' : '⚠️  Unexpected format');

        if (!startsWithShpss) {
          console.log('  ⚠️  WARNING: API Secret Key should start with "shpss_"');
          console.log('  ⚠️  This will cause HMAC validation failures!');
        }
      } else {
        console.log('  ❌ CRITICAL: No API Secret Key stored!');
        console.log('  ❌ HMAC validation will ALWAYS fail for webhooks from this shop!');
      }
    }

    console.log('');
    console.log('Created:', new Date(int.created_at).toLocaleString());
    console.log('─'.repeat(60));
  });

  // Summary
  console.log('\n=== SUMMARY ===\n');
  const oauthCount = data.filter(d => !!d.scope).length;
  const customAppCount = data.filter(d => !!d.api_key).length;
  const missingUserIdCount = data.filter(d => !d.user_id).length;
  const missingShopCount = data.filter(d => !d.shop).length;
  const missingSecretCount = data.filter(d => d.api_key && !d.api_secret_key).length;

  console.log(`Total integrations: ${data.length}`);
  console.log(`OAuth Apps: ${oauthCount}`);
  console.log(`Custom Apps: ${customAppCount}`);
  console.log('');
  console.log('Issues found:');
  console.log(`  Missing user_id: ${missingUserIdCount}`);
  console.log(`  Missing shop: ${missingShopCount}`);
  console.log(`  Missing api_secret_key (Custom Apps): ${missingSecretCount} ${missingSecretCount > 0 ? '❌ CRITICAL' : '✅'}`);

  if (missingSecretCount > 0) {
    console.log('\n⚠️  CRITICAL ISSUE DETECTED:');
    console.log('Custom App integrations are missing api_secret_key.');
    console.log('This causes HMAC validation failures for webhooks.');
    console.log('\nTo fix:');
    console.log('1. Get the API Secret Key from Shopify Admin → Apps → Custom App');
    console.log('2. Update the database with the correct secret');
    console.log('3. Restart the backend server');
  }

  console.log('');
  process.exit(0);
}

checkIntegrations();

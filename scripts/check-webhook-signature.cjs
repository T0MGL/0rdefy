#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function checkSignatures() {
  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .select('shop_domain, api_secret_key, webhook_signature');

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log('\n=== WEBHOOK SECRETS COMPARISON ===\n');

  data.forEach(int => {
    console.log(`Shop: ${int.shop_domain}`);
    console.log(`  api_secret_key: ${int.api_secret_key || 'null'}`);
    console.log(`  webhook_signature: ${int.webhook_signature || 'null'}`);
    console.log(`  Match: ${int.api_secret_key === int.webhook_signature ? '✅' : '❌'}`);
    console.log('');
  });

  process.exit(0);
}

checkSignatures();

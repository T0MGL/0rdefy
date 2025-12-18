const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixWebhookSecret() {
  const correctSecret = '4dfa0083747bc3290450cb6d0269ac2a12633e3972bc312087a16430f20c8148';
  const shopDomain = 's17fez-rb.myshopify.com';

  console.log(`🔧 Updating webhook secret for ${shopDomain}...`);

  const { data, error } = await supabase
    .from('shopify_integrations')
    .update({ webhook_signature: correctSecret })
    .eq('shop_domain', shopDomain)
    .select('shop_domain, webhook_signature');

  if (error) {
    console.error('❌ Error updating webhook secret:', error);
    process.exit(1);
  }

  if (data && data.length > 0) {
    console.log('✅ Webhook secret updated successfully:');
    console.log(`   Shop: ${data[0].shop_domain}`);
    console.log(`   Secret: ${data[0].webhook_signature.substring(0, 20)}...`);
  } else {
    console.log('⚠️  No matching integration found. Current integrations:');
    const { data: integrations } = await supabase
      .from('shopify_integrations')
      .select('shop_domain, webhook_signature');

    console.log(integrations);
  }
}

fixWebhookSecret().catch(console.error);

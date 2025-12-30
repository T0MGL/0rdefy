#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function update() {
  console.log('\n=== ACTUALIZANDO WEBHOOK SIGNATURE CORRECTO ===\n');
  
  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .update({ webhook_signature: '4dfa0083747bc3290450cb6d0269ac2a12633e3972bc312087a16430f20c8148' })
    .eq('shop_domain', 's17fez-rb.myshopify.com')
    .select('shop_domain, webhook_signature, api_secret_key');

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  console.log('✅ ACTUALIZADO EXITOSAMENTE:\n');
  console.log('Shop:', data[0].shop_domain);
  console.log('webhook_signature:', data[0].webhook_signature.substring(0, 20) + '...');
  console.log('api_secret_key:', data[0].api_secret_key);
  console.log('\n✅ Reinicia el backend y crea una orden de prueba\n');
  
  process.exit(0);
}

update();

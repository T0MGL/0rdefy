#!/usr/bin/env node
/**
 * Actualizar webhook_signature con el API Secret Key correcto
 * IMPORTANTE: El secret debe empezar con shpss_ (NO shpat_)
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables!');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function updateWebhookSecret() {
  // IMPORTANTE: Reemplaza 'TU_SECRET_AQUI' con el API Secret Key real de Shopify
  // El secret DEBE empezar con shpss_ (NO con shpat_)
  const apiSecretKey = 'TU_SECRET_AQUI'; // ← REEMPLAZAR CON EL shpss_... de Shopify

  if (apiSecretKey === 'TU_SECRET_AQUI') {
    console.error('❌ ERROR: Debes reemplazar TU_SECRET_AQUI con el API Secret Key real');
    console.error('   Ve a Shopify Admin → Apps → Custom App → API credentials');
    console.error('   Copia el "API secret key" (debe empezar con shpss_)');
    process.exit(1);
  }

  if (!apiSecretKey.startsWith('shpss_')) {
    console.error('❌ ERROR: El API Secret Key debe empezar con "shpss_"');
    console.error('   Recibido:', apiSecretKey.substring(0, 10));
    console.error('   Verifica que no estés usando el Access Token (shpat_)');
    process.exit(1);
  }

  console.log('\n=== ACTUALIZANDO WEBHOOK SECRET ===\n');

  const { data, error } = await supabaseAdmin
    .from('shopify_integrations')
    .update({ webhook_signature: apiSecretKey })
    .eq('shop_domain', 's17fez-rb.myshopify.com')
    .select('shop_domain, webhook_signature');

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  console.log('✅ Webhook secret actualizado exitosamente:');
  console.log('   Shop:', data[0].shop_domain);
  console.log('   Secret:', data[0].webhook_signature.substring(0, 15) + '...');
  console.log('\n🔄 Ahora reinicia el backend y prueba crear una orden.\n');

  process.exit(0);
}

updateWebhookSecret();

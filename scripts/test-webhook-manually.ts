import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testWebhook() {
  // Obtener integración de biovitalidad
  const { data: int } = await supabase
    .from('shopify_integrations')
    .select('*')
    .ilike('shop_domain', '%zsxufa%')
    .single();

  if (!int) {
    console.log('No se encontró la integración');
    return;
  }

  console.log('Tienda:', int.shop_domain);
  console.log('API Secret Key:', int.api_secret_key ? int.api_secret_key.substring(0, 15) + '...' : 'NULL');

  // Simular un payload de webhook de Shopify
  const testPayload = {
    id: 9999999999,
    order_number: '9999',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    test: true,
    total_price: '100.00',
    currency: 'PYG',
    financial_status: 'pending',
    fulfillment_status: null,
    customer: {
      id: 123,
      email: 'test@test.com',
      first_name: 'Test',
      last_name: 'Customer'
    },
    line_items: []
  };

  const payloadString = JSON.stringify(testPayload);

  // Calcular HMAC con el api_secret_key de la integración
  const hmac = crypto
    .createHmac('sha256', int.api_secret_key)
    .update(payloadString, 'utf8')
    .digest('base64');

  console.log('\n=== ENVIANDO WEBHOOK DE PRUEBA ===\n');
  console.log('URL: https://api.ordefy.io/api/shopify/webhook/orders-create');
  console.log('HMAC (base64):', hmac);
  console.log('Shop Domain:', int.shop_domain);

  try {
    const response = await axios.post(
      'https://api.ordefy.io/api/shopify/webhook/orders-create',
      payloadString,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Hmac-Sha256': hmac,
          'X-Shopify-Shop-Domain': int.shop_domain,
          'X-Shopify-Topic': 'orders/create',
          'X-Shopify-Webhook-Id': 'test-' + Date.now()
        },
        timeout: 30000
      }
    );

    console.log('\n✅ Respuesta del servidor:');
    console.log('   Status:', response.status);
    console.log('   Data:', response.data);

  } catch (err: any) {
    console.log('\n❌ Error:');
    console.log('   Status:', err.response?.status);
    console.log('   Data:', err.response?.data);
    console.log('   Message:', err.message);
  }
}

testWebhook();

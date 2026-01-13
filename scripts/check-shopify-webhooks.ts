import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkWebhooks() {
  const { data: int } = await supabase
    .from('shopify_integrations')
    .select('*')
    .ilike('shop_domain', '%zsxufa%')
    .single();

  if (!int) {
    console.log('No se encontró la integración');
    return;
  }

  console.log('Consultando webhooks en Shopify para:', int.shop_domain);
  console.log('Access Token presente:', !!int.access_token);

  try {
    const url = 'https://' + int.shop_domain + '/admin/api/2025-10/webhooks.json';
    const response = await axios.get(url, {
      headers: { 'X-Shopify-Access-Token': int.access_token },
      timeout: 15000
    });

    const webhooks = response.data.webhooks || [];
    console.log('\nWebhooks registrados en Shopify:', webhooks.length);

    for (const wh of webhooks) {
      console.log('\n- Topic:', wh.topic);
      console.log('  ID:', wh.id);
      console.log('  Address:', wh.address);
      console.log('  Format:', wh.format);
      console.log('  Created:', wh.created_at);
    }

    // Verificar órdenes recientes en Shopify
    console.log('\n\n=== ÓRDENES RECIENTES EN SHOPIFY ===\n');
    const ordersUrl = 'https://' + int.shop_domain + '/admin/api/2025-10/orders.json?status=any&limit=5';
    const ordersResponse = await axios.get(ordersUrl, {
      headers: { 'X-Shopify-Access-Token': int.access_token },
      timeout: 15000
    });

    const orders = ordersResponse.data.orders || [];
    console.log('Órdenes en Shopify:', orders.length);

    for (const o of orders) {
      console.log('\n- Order #' + o.order_number + ' (ID: ' + o.id + ')');
      console.log('  Created:', o.created_at);
      console.log('  Financial Status:', o.financial_status);
      console.log('  Fulfillment Status:', o.fulfillment_status);
      console.log('  Total:', o.total_price + ' ' + o.currency);
    }

  } catch (err: any) {
    console.log('Error:', err.response?.data || err.message);
  }
}

checkWebhooks();

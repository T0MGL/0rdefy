import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHOPIFY_API_VERSION = '2025-10';
const API_URL = 'https://api.ordefy.io';

const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'products/delete',
  'app/uninstalled'
];

async function registerWebhooks() {
  console.log('\n=== REGISTRANDO WEBHOOKS PARA BIOVITALIDAD ===\n');

  // 1. Obtener la integración
  const { data: integration, error } = await supabase
    .from('shopify_integrations')
    .select('*')
    .or('shop_domain.ilike.%biovitalidad%,shop_domain.ilike.%zsxufa%')
    .single();

  if (error || !integration) {
    console.error('❌ No se encontró la integración');
    return;
  }

  console.log('✅ Integración:', integration.shop_domain);
  console.log('   Access Token:', integration.access_token ? 'Presente' : 'FALTA');

  const shop = integration.shop_domain;
  const accessToken = integration.access_token;

  // 2. Verificar webhooks existentes en Shopify
  console.log('\n📋 Verificando webhooks existentes en Shopify...');

  try {
    const listResponse = await axios.get(
      'https://' + shop + '/admin/api/' + SHOPIFY_API_VERSION + '/webhooks.json',
      {
        headers: { 'X-Shopify-Access-Token': accessToken },
        timeout: 15000
      }
    );

    const existingWebhooks = listResponse.data.webhooks || [];
    console.log('   Webhooks existentes en Shopify:', existingWebhooks.length);

    for (const wh of existingWebhooks) {
      console.log('   - ' + wh.topic + ': ' + wh.address);
    }
  } catch (err: any) {
    console.error('❌ Error listando webhooks:', err.response?.data || err.message);
    return;
  }

  // 3. Registrar cada webhook
  console.log('\n🔧 Registrando webhooks...\n');

  for (const topic of WEBHOOK_TOPICS) {
    const webhookUrl = API_URL + '/api/shopify/webhook/' + topic.replace('/', '-');

    try {
      // Primero verificar si ya existe
      const checkResponse = await axios.get(
        'https://' + shop + '/admin/api/' + SHOPIFY_API_VERSION + '/webhooks.json',
        {
          headers: { 'X-Shopify-Access-Token': accessToken },
          timeout: 10000
        }
      );

      const existing = (checkResponse.data.webhooks || []).find(
        (w: any) => w.topic === topic
      );

      if (existing) {
        if (existing.address === webhookUrl) {
          console.log('✅ [' + topic + '] Ya existe con URL correcta');

          // Guardar en DB si no está
          await supabase
            .from('shopify_webhooks')
            .upsert({
              integration_id: integration.id,
              webhook_id: existing.id.toString(),
              topic,
              shop_domain: shop,
              is_active: true
            }, { onConflict: 'integration_id,topic' });

          continue;
        } else {
          // Eliminar el viejo
          console.log('🔄 [' + topic + '] Eliminando webhook con URL incorrecta...');
          await axios.delete(
            'https://' + shop + '/admin/api/' + SHOPIFY_API_VERSION + '/webhooks/' + existing.id + '.json',
            {
              headers: { 'X-Shopify-Access-Token': accessToken },
              timeout: 10000
            }
          );
        }
      }

      // Crear nuevo webhook
      console.log('📝 [' + topic + '] Creando webhook: ' + webhookUrl);

      const response = await axios.post(
        'https://' + shop + '/admin/api/' + SHOPIFY_API_VERSION + '/webhooks.json',
        {
          webhook: {
            topic,
            address: webhookUrl,
            format: 'json'
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const newWebhook = response.data.webhook;
      console.log('✅ [' + topic + '] Registrado exitosamente (ID: ' + newWebhook.id + ')');

      // Guardar en base de datos
      await supabase
        .from('shopify_webhooks')
        .upsert({
          integration_id: integration.id,
          webhook_id: newWebhook.id.toString(),
          topic,
          shop_domain: shop,
          is_active: true
        }, { onConflict: 'integration_id,topic' });

    } catch (err: any) {
      console.error('❌ [' + topic + '] Error:', err.response?.data || err.message);
    }
  }

  // 4. Verificar resultado final
  console.log('\n=== VERIFICACIÓN FINAL ===\n');

  const { data: webhooks } = await supabase
    .from('shopify_webhooks')
    .select('*')
    .eq('integration_id', integration.id);

  console.log('Webhooks en base de datos:', webhooks?.length || 0);
  if (webhooks) {
    for (const wh of webhooks) {
      console.log('   - ' + wh.topic + ': ' + (wh.is_active ? '✅' : '❌'));
    }
  }

  console.log('\n=== PROCESO COMPLETADO ===\n');
}

registerWebhooks().catch(console.error);

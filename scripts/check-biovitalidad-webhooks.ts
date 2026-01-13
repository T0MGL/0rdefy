import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBiovitalidad() {
  console.log('\n=== VERIFICANDO TIENDA BIOVITALIDAD ===\n');

  // 1. Buscar la integración
  const { data: integration, error: intError } = await supabase
    .from('shopify_integrations')
    .select('*')
    .or('shop_domain.ilike.%biovitalidad%,shop_domain.ilike.%zsxufa%')
    .single();

  if (intError || !integration) {
    console.log('❌ No se encontró integración para biovitalidad');

    // Intentar buscar por todas las integraciones recientes
    const { data: allIntegrations } = await supabase
      .from('shopify_integrations')
      .select('id, shop_domain, shop_name, status, is_custom_app, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    console.log('\n📋 Integraciones recientes:');
    console.table(allIntegrations);
    return;
  }

  console.log('✅ Integración encontrada:');
  console.log('   - ID:', integration.id);
  console.log('   - Shop:', integration.shop_domain);
  console.log('   - Shop Name:', integration.shop_name);
  console.log('   - Status:', integration.status);
  console.log('   - Is Custom App:', integration.is_custom_app);
  console.log('   - Has Access Token:', !!integration.access_token);
  console.log('   - Scopes:', integration.scope);
  console.log('   - Webhook Signature:', integration.webhook_signature ? 'SET' : 'NOT SET');
  console.log('   - Created:', integration.created_at);
  console.log('   - Updated:', integration.updated_at);

  // 2. Verificar webhooks registrados
  console.log('\n=== WEBHOOKS REGISTRADOS ===\n');
  const { data: webhooks, error: whError } = await supabase
    .from('shopify_webhooks')
    .select('*')
    .eq('integration_id', integration.id);

  if (whError || !webhooks || webhooks.length === 0) {
    console.log('⚠️  No hay webhooks registrados en la base de datos');
  } else {
    console.log('📋 ' + webhooks.length + ' webhooks registrados:');
    for (const wh of webhooks) {
      const status = wh.is_active ? '✅ Activo' : '❌ Inactivo';
      console.log('   - ' + wh.topic + ': ' + status);
    }
  }

  // 3. Verificar eventos de webhook recibidos
  console.log('\n=== EVENTOS DE WEBHOOK RECIBIDOS ===\n');
  const { data: events, error: evError } = await supabase
    .from('shopify_webhook_events')
    .select('*')
    .eq('shop_domain', integration.shop_domain)
    .order('received_at', { ascending: false })
    .limit(20);

  if (evError || !events || events.length === 0) {
    console.log('⚠️  No hay eventos de webhook registrados para esta tienda');
  } else {
    console.log('📋 ' + events.length + ' eventos recientes:');
    for (const ev of events) {
      console.log('   - [' + ev.received_at + '] ' + ev.topic + ': ' + ev.status + ' (' + ev.processing_time_ms + 'ms)');
    }
  }

  // 4. Verificar cola de reintentos
  console.log('\n=== COLA DE REINTENTOS ===\n');
  const { data: retries, error: retError } = await supabase
    .from('shopify_webhook_retry_queue')
    .select('*')
    .eq('shop_domain', integration.shop_domain)
    .order('created_at', { ascending: false })
    .limit(10);

  if (retError || !retries || retries.length === 0) {
    console.log('✅ No hay webhooks en cola de reintentos');
  } else {
    console.log('⚠️  ' + retries.length + ' webhooks pendientes de reintento:');
    for (const r of retries) {
      console.log('   - ' + r.topic + ': intentos=' + r.retry_count + ', próximo=' + r.next_retry_at);
    }
  }

  // 5. Verificar órdenes en Ordefy para este store
  console.log('\n=== ÓRDENES EN ORDEFY ===\n');
  const { data: orders, error: ordError } = await supabase
    .from('orders')
    .select('id, order_number, shopify_order_id, status, created_at')
    .eq('store_id', integration.store_id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (ordError || !orders || orders.length === 0) {
    console.log('⚠️  No hay órdenes para esta tienda en Ordefy');
  } else {
    console.log('📋 ' + orders.length + ' órdenes recientes:');
    for (const o of orders) {
      const shopifyId = o.shopify_order_id || 'N/A';
      console.log('   - #' + o.order_number + ' (Shopify: ' + shopifyId + '): ' + o.status + ' - ' + o.created_at);
    }
  }

  // 6. Verificar métricas de webhooks
  console.log('\n=== MÉTRICAS DE WEBHOOKS ===\n');
  const { data: metrics, error: metError } = await supabase
    .from('shopify_webhook_metrics')
    .select('*')
    .eq('shop_domain', integration.shop_domain)
    .order('hour', { ascending: false })
    .limit(5);

  if (metError || !metrics || metrics.length === 0) {
    console.log('ℹ️  No hay métricas de webhooks registradas');
  } else {
    console.log('📊 Métricas recientes:');
    for (const m of metrics) {
      console.log('   - [' + m.hour + '] ' + m.topic + ': recibidos=' + m.received_count + ', procesados=' + m.processed_count + ', fallidos=' + m.failed_count);
    }
  }

  console.log('\n=== FIN DEL DIAGNÓSTICO ===\n');
}

checkBiovitalidad().catch(console.error);

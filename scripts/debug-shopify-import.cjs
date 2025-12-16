// Script para debuggear importación de Shopify
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function debugImport() {
  console.log('🔍 Verificando integración de Shopify...\n');

  // 1. Verificar integración
  const { data: integration, error: integrationError } = await supabase
    .from('shopify_integrations')
    .select('*')
    .eq('shop_domain', 's17fez-rb.myshopify.com')
    .single();

  if (integrationError || !integration) {
    console.error('❌ No se encontró la integración');
    console.error(integrationError);
    return;
  }

  console.log('✅ Integración encontrada:');
  console.log(`   ID: ${integration.id}`);
  console.log(`   Store ID: ${integration.store_id}`);
  console.log(`   Status: ${integration.status}`);
  console.log(`   Shop: ${integration.shop_domain}`);
  console.log('');

  // 2. Verificar jobs de importación
  const { data: jobs, error: jobsError } = await supabase
    .from('shopify_import_jobs')
    .select('*')
    .eq('integration_id', integration.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (jobsError) {
    console.error('❌ Error obteniendo jobs:', jobsError);
    return;
  }

  console.log(`📊 Jobs de importación (últimos 5):`);
  if (!jobs || jobs.length === 0) {
    console.log('   ⚠️  No hay jobs de importación registrados');
  } else {
    jobs.forEach((job, index) => {
      console.log(`\n   Job ${index + 1}:`);
      console.log(`   - ID: ${job.id}`);
      console.log(`   - Tipo: ${job.job_type}`);
      console.log(`   - Resource: ${job.resource_type}`);
      console.log(`   - Status: ${job.status}`);
      console.log(`   - Items procesados: ${job.items_processed || 0}`);
      console.log(`   - Items totales: ${job.total_items || 0}`);
      console.log(`   - Error: ${job.error || 'N/A'}`);
      console.log(`   - Creado: ${new Date(job.created_at).toLocaleString()}`);
      console.log(`   - Completado: ${job.completed_at ? new Date(job.completed_at).toLocaleString() : 'N/A'}`);
    });
  }
  console.log('');

  // 3. Verificar productos en Ordefy
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, shopify_product_id, stock')
    .eq('store_id', integration.store_id)
    .limit(10);

  if (productsError) {
    console.error('❌ Error obteniendo productos:', productsError);
    return;
  }

  console.log(`📦 Productos en Ordefy:`);
  if (!products || products.length === 0) {
    console.log('   ⚠️  No hay productos en la base de datos');
  } else {
    console.log(`   Total encontrados: ${products.length}`);
    products.forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name} (ID: ${product.id}, Shopify ID: ${product.shopify_product_id || 'N/A'}, Stock: ${product.stock})`);
    });
  }
  console.log('');

  // 4. Probar conexión con Shopify API
  console.log('🔌 Probando conexión con Shopify API...');
  try {
    const response = await fetch(`https://${integration.shop_domain}/admin/api/2024-10/products.json?limit=5`, {
      headers: {
        'X-Shopify-Access-Token': integration.access_token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`   ❌ Error ${response.status}: ${response.statusText}`);
      const errorText = await response.text();
      console.error(`   Respuesta: ${errorText}`);
    } else {
      const data = await response.json();
      console.log(`   ✅ Conexión exitosa`);
      console.log(`   Productos disponibles en Shopify: ${data.products?.length || 0}`);
      if (data.products && data.products.length > 0) {
        console.log('   Primeros productos:');
        data.products.slice(0, 3).forEach((p, i) => {
          console.log(`   ${i + 1}. ${p.title} (ID: ${p.id}, Variants: ${p.variants?.length || 0})`);
        });
      }
    }
  } catch (error) {
    console.error('   ❌ Error de conexión:', error.message);
  }
}

debugImport().then(() => {
  console.log('\n✅ Diagnóstico completado');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Error en diagnóstico:', error);
  process.exit(1);
});

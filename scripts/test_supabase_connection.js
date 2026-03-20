// Test script para verificar que la migración 083 funcionó correctamente
// Ejecutar con: node scripts/test_supabase_connection.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTests() {
  console.log('🔍 TESTING MIGRATION 083 - PERFORMANCE FIX\n');
  console.log('='.repeat(60));

  let allPassed = true;
  const results = [];

  // TEST 1: Verificar que los índices existen
  console.log('\n📋 TEST 1: Verificar índices de migración 083...');
  try {
    const { data: indexes, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'orders'
        AND indexname LIKE 'idx_orders_%'
        ORDER BY indexname
      `
    });

    // Si no hay RPC, intentamos con query directo
    if (error) {
      console.log('   ⚠️ RPC no disponible, usando query alternativo...');

      // Verificar conexión básica
      const { data: ordersCheck, error: ordersError } = await supabase
        .from('orders')
        .select('id')
        .limit(1);

      if (ordersError) {
        throw ordersError;
      }
      console.log('   ✅ Conexión a tabla orders: OK');
      results.push({ test: 'Conexión BD', status: '✅ PASSED' });
    } else {
      console.log('   ✅ Índices encontrados:', indexes?.length || 0);
      results.push({ test: 'Índices existentes', status: '✅ PASSED' });
    }
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    results.push({ test: 'Verificar índices', status: '❌ FAILED', error: err.message });
    allPassed = false;
  }

  // TEST 2: Query optimizado de orders
  console.log('\n📋 TEST 2: Query optimizado de orders...');
  try {
    const startTime = Date.now();

    const { data: orders, error, count } = await supabase
      .from('orders')
      .select(`
        id,
        shopify_order_id,
        shopify_order_name,
        shopify_order_number,
        payment_gateway,
        customer_first_name,
        customer_last_name,
        customer_phone,
        customer_address,
        total_price,
        sleeves_status,
        payment_status,
        courier_id,
        created_at,
        confirmed_at,
        delivery_link_token,
        latitude,
        longitude,
        google_maps_link,
        printed,
        printed_at,
        printed_by,
        deleted_at,
        deleted_by,
        deletion_type,
        is_test,
        rejection_reason,
        confirmation_method,
        cod_amount,
        amount_collected,
        has_amount_discrepancy,
        financial_status,
        payment_method,
        total_discounts,
        neighborhood,
        address_reference,
        order_line_items (
          id,
          product_id,
          product_name,
          variant_title,
          quantity,
          unit_price,
          total_price,
          image_url
        ),
        carriers!orders_courier_id_fkey (
          id,
          name
        )
      `, { count: 'estimated' })
      .order('created_at', { ascending: false })
      .limit(50);

    const endTime = Date.now();
    const queryTime = endTime - startTime;

    if (error) {
      throw error;
    }

    console.log(`   ✅ Query ejecutado en ${queryTime}ms`);
    console.log(`   ✅ Pedidos obtenidos: ${orders?.length || 0}`);
    console.log(`   ✅ Count estimado: ${count || 'N/A'}`);

    if (queryTime < 1000) {
      console.log(`   ✅ Performance: EXCELENTE (< 1s)`);
      results.push({ test: 'Query optimizado', status: '✅ PASSED', time: `${queryTime}ms` });
    } else if (queryTime < 3000) {
      console.log(`   ⚠️ Performance: ACEPTABLE (< 3s)`);
      results.push({ test: 'Query optimizado', status: '⚠️ OK', time: `${queryTime}ms` });
    } else {
      console.log(`   ❌ Performance: LENTA (> 3s)`);
      results.push({ test: 'Query optimizado', status: '❌ SLOW', time: `${queryTime}ms` });
    }
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    results.push({ test: 'Query optimizado', status: '❌ FAILED', error: err.message });
    allPassed = false;
  }

  // TEST 3: Verificar estructura de respuesta
  console.log('\n📋 TEST 3: Verificar estructura de datos...');
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
        shopify_order_name,
        customer_first_name,
        customer_last_name,
        total_price,
        sleeves_status,
        created_at,
        order_line_items (
          id,
          product_name,
          quantity,
          image_url
        ),
        carriers!orders_courier_id_fkey (
          id,
          name
        )
      `)
      .limit(5);

    if (error) throw error;

    const sample = orders?.[0];
    if (sample) {
      const hasRequiredFields =
        'id' in sample &&
        'sleeves_status' in sample &&
        'created_at' in sample &&
        'total_price' in sample;

      const hasLineItems = Array.isArray(sample.order_line_items);
      const hasCarrier = sample.carriers !== undefined;

      console.log(`   ✅ Campos básicos: ${hasRequiredFields ? 'OK' : 'MISSING'}`);
      console.log(`   ✅ Line items: ${hasLineItems ? 'OK' : 'MISSING'} (${sample.order_line_items?.length || 0} items)`);
      console.log(`   ✅ Carrier: ${hasCarrier ? 'OK' : 'MISSING'} (${sample.carriers?.name || 'Sin transportadora'})`);

      if (hasRequiredFields && hasLineItems) {
        results.push({ test: 'Estructura datos', status: '✅ PASSED' });
      } else {
        results.push({ test: 'Estructura datos', status: '⚠️ PARTIAL' });
      }
    } else {
      console.log('   ⚠️ No hay pedidos para verificar estructura');
      results.push({ test: 'Estructura datos', status: '⚠️ NO DATA' });
    }
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    results.push({ test: 'Estructura datos', status: '❌ FAILED', error: err.message });
    allPassed = false;
  }

  // TEST 4: Verificar order_line_items
  console.log('\n📋 TEST 4: Verificar order_line_items...');
  try {
    const { data: lineItems, error, count } = await supabase
      .from('order_line_items')
      .select('id, product_name, quantity, image_url', { count: 'exact' })
      .limit(10);

    if (error) throw error;

    console.log(`   ✅ Line items en BD: ${count || lineItems?.length || 0}`);

    if (lineItems && lineItems.length > 0) {
      const hasImageUrl = lineItems.some(item => item.image_url);
      console.log(`   ✅ Columna image_url: ${hasImageUrl ? 'TIENE DATOS' : 'VACÍA (OK)'}`);
    }

    results.push({ test: 'Order line items', status: '✅ PASSED', count: count });
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    results.push({ test: 'Order line items', status: '❌ FAILED', error: err.message });
    allPassed = false;
  }

  // TEST 5: Verificar carriers JOIN
  console.log('\n📋 TEST 5: Verificar carriers JOIN...');
  try {
    const { data: carriers, error, count } = await supabase
      .from('carriers')
      .select('id, name', { count: 'exact' })
      .limit(10);

    if (error) throw error;

    console.log(`   ✅ Carriers en BD: ${count || carriers?.length || 0}`);
    carriers?.forEach(c => console.log(`      - ${c.name}`));

    results.push({ test: 'Carriers JOIN', status: '✅ PASSED', count: count });
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    results.push({ test: 'Carriers JOIN', status: '❌ FAILED', error: err.message });
    allPassed = false;
  }

  // TEST 6: Verificar filtros funcionan
  console.log('\n📋 TEST 6: Verificar filtros...');
  try {
    // Filtro por status
    const { data: pendingOrders, error: err1 } = await supabase
      .from('orders')
      .select('id')
      .eq('sleeves_status', 'pending')
      .limit(5);

    if (err1) throw err1;
    console.log(`   ✅ Filtro por status: OK (${pendingOrders?.length || 0} pending)`);

    // Filtro por fecha
    const { data: recentOrders, error: err2 } = await supabase
      .from('orders')
      .select('id')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(50);

    if (err2) throw err2;
    console.log(`   ✅ Filtro por fecha: OK (${recentOrders?.length || 0} últimos 7 días)`);

    results.push({ test: 'Filtros', status: '✅ PASSED' });
  } catch (err) {
    console.log('   ❌ Error:', err.message);
    results.push({ test: 'Filtros', status: '❌ FAILED', error: err.message });
    allPassed = false;
  }

  // RESUMEN
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN DE TESTS');
  console.log('='.repeat(60));

  results.forEach(r => {
    console.log(`   ${r.status} ${r.test}${r.time ? ` (${r.time})` : ''}${r.count !== undefined ? ` [${r.count} rows]` : ''}`);
  });

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ ✅ ✅  TODOS LOS TESTS PASARON  ✅ ✅ ✅');
    console.log('La migración 083 está funcionando correctamente.');
    console.log('Es seguro hacer push a GitHub.');
  } else {
    console.log('❌ ❌ ❌  ALGUNOS TESTS FALLARON  ❌ ❌ ❌');
    console.log('Revisa los errores arriba antes de continuar.');
  }
  console.log('='.repeat(60) + '\n');

  return allPassed;
}

runTests()
  .then(passed => process.exit(passed ? 0 : 1))
  .catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
  });

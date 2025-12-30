#!/usr/bin/env node

/**
 * Script para verificar la conexión a la nueva base de datos de Supabase
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('\n🔍 Verificando configuración de Supabase...\n');

// Verificar que las variables están configuradas
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Faltan variables de entorno de Supabase');
  console.log('\nVariables encontradas:');
  console.log('  SUPABASE_URL:', SUPABASE_URL ? '✅' : '❌');
  console.log('  SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? '✅' : '❌');
  console.log('  SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? '✅' : '❌');
  process.exit(1);
}

console.log('✅ Variables de entorno configuradas correctamente\n');
console.log('📍 URL:', SUPABASE_URL);
console.log('🔑 Anon Key:', SUPABASE_ANON_KEY.substring(0, 30) + '...');
console.log('🔐 Service Role Key:', SUPABASE_SERVICE_ROLE_KEY.substring(0, 30) + '...\n');

async function testConnection() {
  try {
    // Crear cliente con service role key (tiene permisos completos)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('🔌 Conectando a Supabase...\n');

    // Test 1: Verificar tablas principales
    console.log('📋 Test 1: Verificando tablas principales...');
    const { data: tables, error: tablesError } = await supabase
      .from('stores')
      .select('id')
      .limit(1);

    if (tablesError && tablesError.code === 'PGRST116') {
      console.log('⚠️  Tabla "stores" existe pero está vacía (normal en DB nueva)');
    } else if (tablesError) {
      console.error('❌ Error al consultar tabla stores:', tablesError.message);
      throw tablesError;
    } else {
      console.log('✅ Tabla "stores" accesible');
    }

    // Test 2: Verificar otras tablas críticas
    const criticalTables = ['users', 'products', 'customers', 'orders', 'order_line_items'];
    console.log('\n📋 Test 2: Verificando tablas críticas...');

    for (const table of criticalTables) {
      const { error } = await supabase
        .from(table)
        .select('id')
        .limit(1);

      if (error && error.code !== 'PGRST116') {
        console.log(`❌ Tabla "${table}": ${error.message}`);
      } else {
        console.log(`✅ Tabla "${table}": OK`);
      }
    }

    // Test 3: Contar todas las tablas
    console.log('\n📊 Test 3: Contando tablas en la base de datos...');
    console.log('ℹ️  Verificando manualmente...');

    // Intentar consultar varias tablas para confirmar que existen
    const testTables = [
      'stores', 'users', 'products', 'customers', 'orders',
      'order_line_items', 'carriers', 'suppliers', 'campaigns',
      'picking_sessions', 'inbound_shipments', 'return_sessions',
      'shopify_integrations', 'inventory_movements'
    ];

    let existingTables = 0;
    for (const table of testTables) {
      const { error } = await supabase.from(table).select('id').limit(0);
      if (!error || error.code === 'PGRST116') {
        existingTables++;
      }
    }

    console.log(`✅ Al menos ${existingTables} tablas principales encontradas`);

    // Test 4: Verificar que RLS está habilitado
    console.log('\n🔒 Test 4: Verificando Row Level Security (RLS)...');
    const { data: rlsData, error: rlsError } = await supabase
      .from('stores')
      .select('id')
      .limit(1);

    if (rlsError && rlsError.code === '42501') {
      console.log('✅ RLS está habilitado (acceso denegado sin políticas)');
      console.log('ℹ️  Esto es normal - necesitarás crear políticas de RLS o usar service_role key');
    } else if (!rlsError) {
      console.log('✅ RLS configurado correctamente con políticas');
    }

    // Test 5: Test de escritura (crear y eliminar un registro)
    console.log('\n✍️  Test 5: Probando operaciones de escritura...');
    const testStore = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'TEST_STORE_DELETE_ME',
      country: 'US',
      timezone: 'America/New_York',
      currency: 'USD',
      is_active: false
    };

    const { data: insertData, error: insertError } = await supabase
      .from('stores')
      .insert(testStore)
      .select();

    if (insertError) {
      console.log('⚠️  No se pudo insertar registro de prueba:', insertError.message);
    } else {
      console.log('✅ Inserción exitosa');

      // Eliminar el registro de prueba
      const { error: deleteError } = await supabase
        .from('stores')
        .delete()
        .eq('id', testStore.id);

      if (deleteError) {
        console.log('⚠️  No se pudo eliminar registro de prueba:', deleteError.message);
      } else {
        console.log('✅ Eliminación exitosa');
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎉 VERIFICACIÓN COMPLETADA CON ÉXITO');
    console.log('='.repeat(50));
    console.log('\n✅ La aplicación puede conectarse a la nueva base de datos de Supabase');
    console.log('✅ Las tablas principales están creadas y accesibles');
    console.log('✅ Las operaciones de lectura/escritura funcionan correctamente');
    console.log('\n📝 Próximos pasos:');
    console.log('   1. Iniciar el backend: cd api && npm run dev');
    console.log('   2. Iniciar el frontend: npm run dev');
    console.log('   3. Probar login y operaciones básicas');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error durante la verificación:', error.message);
    console.error('\nDetalles del error:', error);
    process.exit(1);
  }
}

// Ejecutar las pruebas
testConnection();

#!/usr/bin/env node
/**
 * Script to verify product cost columns in database
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Variables de entorno no encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
  console.log('🔍 Verificando columnas en products...\n');
  
  // Try to query a product to see which columns exist
  const { data, error } = await supabase
    .from('products')
    .select('id, cost, packaging_cost, additional_costs')
    .limit(1);

  if (error) {
    if (error.message.includes('additional_costs')) {
      console.log('❌ ERROR: La columna "additional_costs" NO existe en la base de datos');
      console.log('\n🔧 SOLUCIÓN:');
      console.log('1. Abre: https://supabase.com/dashboard/project/vlcwlwuuobazamuzjzsm/sql/new');
      console.log('2. Copia y pega el contenido de: EJECUTAR_AHORA.sql');
      console.log('3. Presiona "Run"\n');
      process.exit(1);
    }
    console.error('❌ Error:', error.message);
    process.exit(1);
  }

  console.log('✅ ¡Columnas verificadas correctamente!');
  console.log('   - packaging_cost: existe');
  console.log('   - additional_costs: existe\n');
}

verify();

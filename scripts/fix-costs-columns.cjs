#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://vlcwlwuuobazamuzjzsm.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsY3dsd3V1b2JhemFtdXpqenNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzE2MTM5MTAsImV4cCI6MjA0NzE4OTkxMH0.mfg8y4ysf8xyaOhXGEdFE32ohxKWDmSQu3_JfOdNILg';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false
  }
});

async function fixColumns() {
  console.log('🔧 Corrigiendo columnas de costos en la tabla products...\n');

  try {
    // Verificar la estructura actual
    console.log('1️⃣ Verificando estructura actual...');
    const { data: sample, error: sampleError } = await supabase
      .from('products')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.error('❌ Error:', sampleError.message);
      throw sampleError;
    }

    if (sample && sample.length > 0) {
      const product = sample[0];
      console.log('   Columnas encontradas:');
      console.log(`   - packaging_cost: ${product.packaging_cost !== undefined ? '✅' : '❌'}`);
      console.log(`   - additional_cost: ${product.additional_cost !== undefined ? '⚠️  (nombre incorrecto)' : '❌'}`);
      console.log(`   - additional_costs: ${product.additional_costs !== undefined ? '✅' : '❌'}`);
    }

    console.log('\n2️⃣ Instrucciones para corregir:');
    console.log('\n📋 Ejecuta el siguiente SQL en tu base de datos Supabase:');
    console.log('\n' + '='.repeat(80));
    console.log(`
-- Paso 1: Renombrar additional_cost a additional_costs si existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'additional_cost'
    ) THEN
        ALTER TABLE products RENAME COLUMN additional_cost TO additional_costs;
        RAISE NOTICE 'Columna renombrada';
    END IF;
END $$;

-- Paso 2: Agregar columnas si no existen
ALTER TABLE products
ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_costs DECIMAL(10,2) DEFAULT 0;
    `.trim());
    console.log('\n' + '='.repeat(80));

    console.log('\n📍 Dónde ejecutarlo:');
    console.log('   1. Ve a https://supabase.com/dashboard/project/vlcwlwuuobazamuzjzsm');
    console.log('   2. Navega a "SQL Editor"');
    console.log('   3. Crea una nueva query');
    console.log('   4. Pega el SQL de arriba');
    console.log('   5. Ejecuta la query');

    console.log('\n✅ Una vez ejecutado, vuelve a ejecutar este script para verificar.\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

fixColumns();

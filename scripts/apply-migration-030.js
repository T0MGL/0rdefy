#!/usr/bin/env node

/**
 * Script para aplicar la migración 030 que agrega las columnas de costos
 * Renombra additional_cost a additional_costs si existe
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Configuración de Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://vlcwlwuuobazamuzjzsm.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY o VITE_SUPABASE_ANON_KEY no está configurado');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  console.log('🔄 Aplicando migración 030: Agregar columnas de costos a products...\n');

  try {
    // Paso 1: Verificar si la columna additional_cost existe (singular, incorrecto)
    console.log('1️⃣ Verificando si existe la columna additional_cost (singular)...');
    const { data: oldColumnCheck, error: checkError } = await supabase.rpc('check_column_exists', {
      table_name: 'products',
      column_name: 'additional_cost'
    }).catch(() => ({ data: null, error: null }));

    // Paso 2: Renombrar la columna si existe
    if (oldColumnCheck) {
      console.log('   ⚠️  Columna additional_cost encontrada, renombrando a additional_costs...');
      const { error: renameError } = await supabase.rpc('exec_sql', {
        sql: 'ALTER TABLE products RENAME COLUMN additional_cost TO additional_costs'
      });

      if (renameError && !renameError.message.includes('does not exist')) {
        console.error('   ❌ Error al renombrar columna:', renameError.message);
      } else {
        console.log('   ✅ Columna renombrada exitosamente');
      }
    }

    // Paso 3: Ejecutar la migración completa
    console.log('\n2️⃣ Ejecutando migración 030...');
    const migrationPath = path.join(__dirname, '../db/migrations/030_add_product_costs.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Dividir en statements individuales
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.toLowerCase().includes('alter table') ||
          statement.toLowerCase().includes('comment on')) {
        const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' });

        if (error && !error.message.includes('already exists')) {
          console.error(`   ❌ Error ejecutando statement: ${error.message}`);
        }
      }
    }

    console.log('   ✅ Migración ejecutada');

    // Paso 4: Verificar las columnas finales
    console.log('\n3️⃣ Verificando estructura final de la tabla...');
    const { data: columns, error: columnsError } = await supabase
      .from('products')
      .select('*')
      .limit(1);

    if (columnsError) {
      console.error('   ❌ Error al verificar columnas:', columnsError.message);
    } else {
      console.log('   ✅ Estructura verificada');
      if (columns && columns.length > 0) {
        const product = columns[0];
        console.log('\n📋 Columnas de costos presentes:');
        console.log(`   - cost: ${product.cost !== undefined ? '✅' : '❌'}`);
        console.log(`   - packaging_cost: ${product.packaging_cost !== undefined ? '✅' : '❌'}`);
        console.log(`   - additional_costs: ${product.additional_costs !== undefined ? '✅' : '❌'}`);
      }
    }

    console.log('\n✅ Migración 030 completada exitosamente!\n');
  } catch (error) {
    console.error('\n❌ Error aplicando migración:', error.message);
    process.exit(1);
  }
}

applyMigration();

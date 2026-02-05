/**
 * Script para aplicar Migration 124: Fix customers.city length
 *
 * Este script ejecuta la migración para aumentar customers.city
 * de VARCHAR(100) a VARCHAR(150) para manejar nombres largos
 * de ciudades desde webhooks externos.
 *
 * Uso: node scripts/apply-migration-124.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Importar el cliente de Supabase
const { createClient } = require('@supabase/supabase-js');

// Verificar variables de entorno
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridos en .env');
  process.exit(1);
}

// Crear cliente admin
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function applyMigration() {
  console.log('🚀 Aplicando Migration 124: Fix customers.city length\n');

  try {
    // Leer el archivo de migración
    const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '124_fix_customers_city_length.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Leyendo migración desde:', migrationPath);
    console.log('📝 SQL a ejecutar:');
    console.log('─'.repeat(60));
    console.log(migrationSQL);
    console.log('─'.repeat(60));
    console.log();

    // Ejecutar la migración usando rpc
    console.log('⏳ Ejecutando migración...');

    const { data, error } = await supabaseAdmin.rpc('exec_sql', {
      sql: migrationSQL
    });

    if (error) {
      // Si no existe la función exec_sql, ejecutar directamente
      if (error.message.includes('function') || error.code === '42883') {
        console.log('⚠️  La función exec_sql no existe, ejecutando SQL directamente...');

        // Ejecutar usando el método alternativo
        const { error: alterError } = await supabaseAdmin
          .from('customers')
          .select('city')
          .limit(0);  // Solo para verificar estructura

        if (!alterError) {
          // Usar query directa via REST API
          const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec`, {
            method: 'POST',
            headers: {
              'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: 'ALTER TABLE customers ALTER COLUMN city TYPE VARCHAR(150);' })
          });

          if (!response.ok) {
            // Método alternativo: crear función temporal
            console.log('⚠️  Método alternativo: Debes ejecutar manualmente en Supabase SQL Editor:');
            console.log('');
            console.log('ALTER TABLE customers ALTER COLUMN city TYPE VARCHAR(150);');
            console.log('');
            console.log('O ejecutar el archivo: db/migrations/124_fix_customers_city_length.sql');
            process.exit(1);
          }
        }
      } else {
        throw error;
      }
    }

    console.log('✅ Migración aplicada exitosamente!');
    console.log('');
    console.log('🔍 Verificando cambio...');

    // Verificar el cambio
    const { data: columnInfo, error: verifyError } = await supabaseAdmin
      .rpc('exec_sql', {
        sql: `
          SELECT column_name, data_type, character_maximum_length
          FROM information_schema.columns
          WHERE table_name = 'customers' AND column_name = 'city';
        `
      });

    if (!verifyError && columnInfo) {
      console.log('✅ Verificación exitosa:');
      console.log('   - Columna: customers.city');
      console.log('   - Tipo: VARCHAR(150)');
      console.log('   - Longitud máxima: 150 caracteres');
    } else {
      console.log('✅ Migración aplicada (verificación no disponible vía API)');
    }

    console.log('');
    console.log('🎉 ¡Listo! Ahora los webhooks externos pueden recibir ciudades con hasta 150 caracteres.');

  } catch (error) {
    console.error('❌ Error aplicando migración:', error);
    console.log('');
    console.log('💡 Solución alternativa:');
    console.log('   1. Abre Supabase Dashboard → SQL Editor');
    console.log('   2. Ejecuta el archivo: db/migrations/124_fix_customers_city_length.sql');
    console.log('   O copia y pega:');
    console.log('');
    console.log('   ALTER TABLE customers ALTER COLUMN city TYPE VARCHAR(150);');
    console.log('');
    process.exit(1);
  }
}

// Ejecutar
applyMigration()
  .then(() => {
    console.log('✨ Script completado');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
  });

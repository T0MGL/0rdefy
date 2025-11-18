/**
 * Script para aplicar la migración 009 - COD Improvements
 * Run: npx tsx api/scripts/apply-migration-009.ts
 */

import { supabaseAdmin } from '../db/connection';
import { readFileSync } from 'fs';
import { join } from 'path';

async function applyMigration() {
  console.log('🔄 Aplicando migración 009_cod_improvements...\n');

  try {
    // Leer el archivo SQL
    const migrationPath = join(__dirname, '../../db/migrations/009_cod_improvements.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Dividir en statements individuales (separados por ;)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.includes('COMMENT ON'));

    console.log(`📝 Encontrados ${statements.length} statements SQL\n`);

    // Ejecutar cada statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip comments and empty lines
      if (statement.startsWith('--') || statement.trim().length === 0) {
        continue;
      }

      console.log(`⏳ Ejecutando statement ${i + 1}/${statements.length}...`);

      try {
        const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: statement });

        if (error) {
          // Si el error es que ya existe, lo ignoramos
          if (error.message.includes('already exists') || error.message.includes('duplicate')) {
            console.log(`  ⚠️  Ya existe, saltando...`);
          } else {
            console.error(`  ❌ Error:`, error.message);
          }
        } else {
          console.log(`  ✅ Completado`);
        }
      } catch (err: any) {
        console.error(`  ❌ Error ejecutando:`, err.message);
      }
    }

    console.log('\n✅ Migración completada!\n');
    console.log('🔍 Verificando tablas creadas...\n');

    // Verificar que las tablas existen
    const { data: deliveryAttempts } = await supabaseAdmin
      .from('delivery_attempts')
      .select('count');

    const { data: settlements } = await supabaseAdmin
      .from('daily_settlements')
      .select('count');

    console.log('✅ delivery_attempts:', deliveryAttempts ? 'OK' : '❌ No existe');
    console.log('✅ daily_settlements:', settlements ? 'OK' : '❌ No existe');

  } catch (error: any) {
    console.error('\n💥 Error aplicando migración:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

applyMigration();

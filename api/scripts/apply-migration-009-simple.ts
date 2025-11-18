/**
 * Script simplificado para aplicar la migración 009 - COD Improvements
 * Run: npx tsx api/scripts/apply-migration-009-simple.ts
 */

import { supabaseAdmin } from '../db/connection';

async function applyMigration() {
  console.log('🔄 Aplicando migración 009_cod_improvements...\n');

  try {
    // Nota: Estos statements deben ejecutarse directamente en el SQL Editor de Supabase
    // ya que el cliente JS no soporta DDL (ALTER TABLE, CREATE TABLE)

    console.log('⚠️  IMPORTANTE: Esta migración debe ejecutarse en el SQL Editor de Supabase\n');
    console.log('📋 Copia el contenido de: db/migrations/009_cod_improvements.sql\n');
    console.log('🔗 Y ejecútalo en: https://supabase.com/dashboard/project/_/sql\n');

    // Intentamos verificar si ya existen las tablas
    console.log('🔍 Verificando si las tablas ya existen...\n');

    const { data: deliveryAttempts, error: err1 } = await supabaseAdmin
      .from('delivery_attempts')
      .select('id')
      .limit(1);

    const { data: settlements, error: err2 } = await supabaseAdmin
      .from('daily_settlements')
      .select('id')
      .limit(1);

    const { data: settlementOrders, error: err3 } = await supabaseAdmin
      .from('settlement_orders')
      .select('id')
      .limit(1);

    console.log('Tabla delivery_attempts:', !err1 ? '✅ Existe' : '❌ No existe');
    console.log('Tabla daily_settlements:', !err2 ? '✅ Existe' : '❌ No existe');
    console.log('Tabla settlement_orders:', !err3 ? '✅ Existe' : '❌ No existe');

    if (err1 || err2 || err3) {
      console.log('\n⚠️  Algunas tablas no existen. Por favor ejecuta la migración SQL manualmente.\n');
    } else {
      console.log('\n✅ Todas las tablas existen!\n');
    }

  } catch (error: any) {
    console.error('\n💥 Error:', error.message);
  }

  process.exit(0);
}

applyMigration();

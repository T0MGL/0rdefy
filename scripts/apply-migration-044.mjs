#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  try {
    console.log('📦 Aplicando migración 044: Add Confirmation Fee...\n');

    const migrationPath = join(__dirname, '../db/migrations/044_add_confirmation_fee.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      console.error('❌ Error aplicando migración:', error);
      process.exit(1);
    }

    console.log('✅ Migración 044 aplicada exitosamente!');
    console.log('\n📊 Campo agregado:');
    console.log('   - store_config.confirmation_fee (DECIMAL(12,2), DEFAULT 0.00)');
    console.log('\n💡 Ahora puedes configurar un costo de confirmación por tienda.');
    console.log('   Este costo se sumará a los costos operativos de cada pedido confirmado.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

applyMigration();

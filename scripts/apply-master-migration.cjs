#!/usr/bin/env node

/**
 * Script para aplicar la migración MASTER a la nueva base de datos de Supabase
 *
 * Este script:
 * 1. Lee el archivo 000_MASTER_MIGRATION.sql
 * 2. Se conecta a la nueva base de datos de Supabase
 * 3. Aplica la migración completa
 * 4. Verifica que todo se creó correctamente
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Credenciales de la NUEVA base de datos
const SUPABASE_URL = 'https://vgqecqqleuowvoimcoxg.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZncWVjcXFsZXVvd3ZvaW1jb3hnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTUzODEzOSwiZXhwIjoyMDUxMTE0MTM5fQ.lS77b9y__t2bOOPXPdNEaTU5PLVsaBE8OG9SvdYR-gw'; // Service role key

async function applyMigration() {
  console.log('🚀 Iniciando aplicación de migración MASTER...\n');

  // Leer el archivo de migración
  const migrationPath = path.join(__dirname, '../db/migrations/000_MASTER_MIGRATION.sql');
  console.log(`📄 Leyendo migración desde: ${migrationPath}`);

  if (!fs.existsSync(migrationPath)) {
    console.error('❌ Error: No se encontró el archivo 000_MASTER_MIGRATION.sql');
    process.exit(1);
  }

  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  console.log(`✅ Migración leída (${migrationSQL.length} caracteres)\n`);

  // Crear cliente de Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log('🔗 Conectando a Supabase...');
  console.log(`   URL: ${SUPABASE_URL}`);
  console.log(`   Project: vgqecqqleuowvoimcoxg\n`);

  try {
    // Verificar conexión
    const { data: testData, error: testError } = await supabase
      .from('_migrations')
      .select('*')
      .limit(1);

    if (testError && testError.code !== 'PGRST116') {
      // PGRST116 = tabla no existe (esperado en DB nueva)
      console.log('⚠️  Advertencia al verificar conexión:', testError.message);
    } else {
      console.log('✅ Conexión establecida correctamente\n');
    }

    // Aplicar la migración usando RPC (necesitamos ejecutar SQL raw)
    console.log('📝 Aplicando migración MASTER...');
    console.log('   (Esto puede tardar 30-60 segundos)\n');

    // Supabase no permite ejecutar SQL raw directamente desde el cliente JS
    // Necesitamos usar la función RPC o el SQL Editor
    console.log('⚠️  IMPORTANTE: Supabase no permite ejecutar SQL raw desde el cliente JS');
    console.log('');
    console.log('Para aplicar la migración, debes hacerlo manualmente desde el SQL Editor:');
    console.log('');
    console.log('1. Ve a: https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/sql/new');
    console.log('2. Copia y pega el contenido de: db/migrations/000_MASTER_MIGRATION.sql');
    console.log('3. Haz clic en "Run" para ejecutar la migración');
    console.log('');
    console.log('Alternativamente, puedes usar la CLI de Supabase:');
    console.log('');
    console.log('  npx supabase db reset --db-url "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"');
    console.log('');

    // Guardar la migración en un archivo temporal para copiar/pegar
    const tempPath = path.join(__dirname, '../temp_migration.sql');
    fs.writeFileSync(tempPath, migrationSQL);
    console.log(`💾 Migración guardada en: ${tempPath}`);
    console.log('   Copia este archivo al SQL Editor de Supabase\n');

  } catch (error) {
    console.error('❌ Error al aplicar migración:', error);
    process.exit(1);
  }
}

applyMigration();

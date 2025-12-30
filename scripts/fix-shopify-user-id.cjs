#!/usr/bin/env node

/**
 * Fix Shopify Integrations - Add user_id and shop
 *
 * This script fixes existing shopify_integrations records that are missing
 * user_id and shop fields. This is critical for webhook processing.
 *
 * Run with: node scripts/fix-shopify-user-id.js
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Colores para terminal
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Verificar DATABASE_URL
if (!process.env.DATABASE_URL) {
  log('❌ ERROR: Falta variable de entorno DATABASE_URL', 'red');
  console.log('\nEjemplo:');
  console.log('  export DATABASE_URL="postgresql://user:pass@host:5432/database"');
  console.log('  node scripts/fix-shopify-user-id.js');
  process.exit(1);
}

// Banner
console.log('\n' + '='.repeat(70));
log('  ORDEFY - Fix Shopify Integrations (user_id + shop)', 'cyan');
console.log('='.repeat(70));
console.log(`Database: ${process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'hidden'}`);
console.log('='.repeat(70) + '\n');

const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '029_fix_shopify_integrations_user_id.sql');

// Verificar que existe el archivo
if (!fs.existsSync(migrationPath)) {
  log(`❌ Archivo de migración no encontrado: ${migrationPath}`, 'red');
  process.exit(1);
}

// Función para ejecutar comando psql
function executeMigration() {
  return new Promise((resolve, reject) => {
    const command = `psql "${process.env.DATABASE_URL}" -f "${migrationPath}"`;

    log('🔧 Aplicando fix de user_id y shop...', 'cyan');
    console.log('');

    const child = exec(command, { maxBuffer: 10 * 1024 * 1024 });

    child.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Proceso terminó con código ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// Función principal
async function main() {
  try {
    // Verificar psql instalado
    const psqlCheck = await new Promise((resolve) => {
      exec('psql --version', (error, stdout) => {
        resolve(!error);
      });
    });

    if (!psqlCheck) {
      log('❌ psql no encontrado. Instalar PostgreSQL client.', 'red');
      console.log('\nInstalación:');
      console.log('  macOS: brew install postgresql');
      console.log('  Ubuntu: sudo apt-get install postgresql-client');
      process.exit(1);
    }

    log('⚠️  Esta operación modificará tu base de datos.', 'yellow');
    console.log('\nCambios que se aplicarán:');
    console.log('  1. Agregar user_id a shopify_integrations (si falta)');
    console.log('  2. Agregar shop a shopify_integrations (si falta)');
    console.log('  3. Poblar user_id desde user_stores table');
    console.log('  4. Poblar shop desde shop_domain (quitar .myshopify.com)');
    console.log('  5. Crear índices para mejor performance');

    // Ejecutar migración
    const startTime = Date.now();
    await executeMigration();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Success
    console.log('\n' + '='.repeat(70));
    log(`✅ Fix aplicado exitosamente en ${duration} segundos`, 'green');
    console.log('='.repeat(70));

    log('\n📝 Próximos pasos:', 'cyan');
    console.log('  1. Reiniciar el servidor backend (para cargar código actualizado)');
    console.log('  2. Probar conexión manual de Shopify');
    console.log('  3. Enviar pedido de prueba desde Shopify');
    console.log('  4. Verificar que el pedido llegue a la base de datos');
    console.log('\n  Los webhooks ahora deberían funcionar correctamente.\n');

  } catch (err) {
    console.log('\n' + '='.repeat(70));
    log('❌ Fix falló', 'red');
    console.log('='.repeat(70));
    console.error('\nDetalles del error:');
    console.error(err.message);

    console.log('\n' + colors.yellow + 'Opciones de recuperación:' + colors.reset);
    console.log('  1. Revisar logs arriba para identificar problema');
    console.log('  2. Verificar permisos de base de datos');
    console.log('  3. Verificar que la tabla shopify_integrations existe');
    console.log('  4. Contactar soporte si el problema persiste');

    process.exit(1);
  }
}

// Ejecutar
main();

#!/usr/bin/env node
/**
 * Script para aplicar Migración 029 (Fix Critical Schema)
 *
 * Uso:
 *   node scripts/apply-migration-029.js [--quick|--concurrent|--transactional]
 *
 * Opciones:
 *   --quick          Fix ultra-rápido (emergencia)
 *   --concurrent     Migración sin bloqueos (recomendado para producción)
 *   --transactional  Migración con transacción (más seguro, breve bloqueo)
 *   --verify-only    Solo verificar, no ejecutar migración
 *
 * Variables de entorno requeridas:
 *   DATABASE_URL     Connection string de PostgreSQL
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
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ERROR: ${message}`, 'red');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function warning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Verificar que existe DATABASE_URL
if (!process.env.DATABASE_URL) {
  error('Falta variable de entorno DATABASE_URL');
  console.log('\nEjemplo:');
  console.log('  export DATABASE_URL="postgresql://user:pass@host:5432/database"');
  console.log('  node scripts/apply-migration-029.js --concurrent');
  process.exit(1);
}

// Parsear argumentos
const args = process.argv.slice(2);
const mode = args.find(arg => arg.startsWith('--'))?.substring(2) || 'concurrent';

// Mapear modo a archivo de migración
const migrationFiles = {
  'verify-only': 'verify_schema_before_029.sql',
  'quick': 'QUICK_FIX_029.sql',
  'concurrent': '029_fix_critical_schema.sql',
  'transactional': '029_fix_critical_schema_transactional.sql',
};

const migrationFile = migrationFiles[mode];

if (!migrationFile) {
  error(`Modo desconocido: ${mode}`);
  console.log('\nModos válidos:');
  Object.keys(migrationFiles).forEach(m => console.log(`  --${m}`));
  process.exit(1);
}

const migrationPath = path.join(__dirname, '..', 'db', 'migrations', migrationFile);

// Verificar que existe el archivo
if (!fs.existsSync(migrationPath)) {
  error(`Archivo de migración no encontrado: ${migrationPath}`);
  process.exit(1);
}

// Banner
console.log('\n' + '='.repeat(60));
log('  ORDEFY - HOTFIX 029: Critical Schema Fix', 'cyan');
console.log('='.repeat(60));
console.log(`Modo: ${mode}`);
console.log(`Archivo: ${migrationFile}`);
console.log(`Database: ${process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'hidden'}`);
console.log('='.repeat(60) + '\n');

// Función para ejecutar comando psql
function executeMigration() {
  return new Promise((resolve, reject) => {
    const command = `psql "${process.env.DATABASE_URL}" -f "${migrationPath}"`;

    info(`Ejecutando migración...`);
    console.log(`\nComando: psql ... -f ${migrationFile}\n`);

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

// Confirmación para modos que modifican datos
async function confirmExecution() {
  if (mode === 'verify-only') {
    return true; // No requiere confirmación
  }

  if (process.env.AUTO_CONFIRM === 'true') {
    warning('AUTO_CONFIRM=true detectado, ejecutando sin confirmación...');
    return true;
  }

  warning('Esta operación MODIFICARÁ tu base de datos.');
  console.log('\nCambios que se aplicarán:');
  console.log('  1. Agregar columna id a shopify_webhook_idempotency');
  console.log('  2. Crear índice UNIQUE en orders.shopify_order_id');
  console.log('  3. Crear índice UNIQUE en orders.(shopify_order_id, store_id)');

  // En Node.js, para CLI interactivo necesitamos readline
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question('\n¿Continuar? (escribir "yes" para confirmar): ', (answer) => {
      readline.close();
      resolve(answer.toLowerCase() === 'yes');
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
      error('psql no encontrado. Instalar PostgreSQL client.');
      console.log('\nInstalación:');
      console.log('  macOS: brew install postgresql');
      console.log('  Ubuntu: sudo apt-get install postgresql-client');
      process.exit(1);
    }

    // Confirmación
    const confirmed = await confirmExecution();
    if (!confirmed) {
      warning('Operación cancelada por el usuario.');
      process.exit(0);
    }

    // Ejecutar migración
    const startTime = Date.now();
    await executeMigration();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Success
    console.log('\n' + '='.repeat(60));
    success(`Migración completada en ${duration} segundos`);
    console.log('='.repeat(60));

    if (mode === 'verify-only') {
      info('Verificación completada. Revisar output arriba.');
    } else {
      info('Próximos pasos:');
      console.log('  1. Probar creación de pedido desde Shopify');
      console.log('  2. Verificar logs de backend (sin errores)');
      console.log('  3. Monitorear webhooks durante próxima hora');
      console.log('\nTesting rápido:');
      console.log('  node scripts/apply-migration-029.js --verify-only');
    }

  } catch (err) {
    console.log('\n' + '='.repeat(60));
    error('Migración falló');
    console.log('='.repeat(60));
    console.error('\nDetalles del error:');
    console.error(err.message);

    console.log('\n' + colors.yellow + 'Opciones de recuperación:' + colors.reset);
    console.log('  1. Revisar logs arriba para identificar problema');
    console.log('  2. Verificar permisos de base de datos');
    console.log('  3. Ejecutar verificación: node scripts/apply-migration-029.js --verify-only');
    console.log('  4. Consultar HOTFIX_029_INSTRUCTIONS.md para rollback');

    process.exit(1);
  }
}

// Ejecutar
main();

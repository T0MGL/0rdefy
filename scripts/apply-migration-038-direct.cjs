/**
 * Apply Migration 038: Soft Delete Orders System
 * Direct execution using pg client
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Parse Supabase connection from URL
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Extract project ref from Supabase URL
const projectRef = supabaseUrl.match(/https:\/\/(.+?)\.supabase\.co/)[1];

// Construct PostgreSQL connection string for Supabase
const connectionString = `postgresql://postgres.${projectRef}:${supabaseServiceKey.replace('eyJ', '')}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

// Use alternative: direct pooler connection
const client = new Client({
  host: `aws-0-us-east-1.pooler.supabase.com`,
  port: 6543,
  database: 'postgres',
  user: `postgres.${projectRef}`,
  password: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ssl: { rejectUnauthorized: false }
});

async function applyMigration() {
  console.log('\n🚀 Starting Migration 038: Soft Delete Orders System\n');

  try {
    // Connect to database
    console.log('🔌 Connecting to Supabase PostgreSQL...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '038_soft_delete_orders_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📝 Executing SQL...\n');

    // Execute migration as a single transaction
    await client.query('BEGIN');
    await client.query(migrationSQL);
    await client.query('COMMIT');

    console.log('\n✅ Migration 038 applied successfully!\n');
    console.log('📊 Summary of changes:');
    console.log('  ✓ Added deleted_at, deleted_by, deletion_type columns to orders');
    console.log('  ✓ Added is_test, marked_test_by, marked_test_at columns to orders');
    console.log('  ✓ Created indexes for filtering deleted/test orders');
    console.log('  ✓ Added smart_order_deletion_with_stock_restoration() function');
    console.log('  ✓ Added trigger_restore_stock_on_hard_delete trigger');
    console.log('  ✓ Added restore_soft_deleted_order() function');
    console.log('  ✓ Added mark_order_as_test() function');

    // Verify changes
    console.log('\n🔍 Verifying changes...');
    const { rows } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'orders'
        AND column_name IN ('deleted_at', 'deleted_by', 'deletion_type', 'is_test', 'marked_test_by', 'marked_test_at')
      ORDER BY column_name;
    `);

    console.log('📋 New columns added:');
    rows.forEach(row => {
      console.log(`  ✓ ${row.column_name} (${row.data_type})`);
    });

    console.log('\n🎯 Next steps:');
    console.log('  1. Restart backend server (API)');
    console.log('  2. Restart frontend server');
    console.log('  3. Test soft delete workflow');
    console.log('  4. Test hard delete with stock restoration');
    console.log('  5. Test restore functionality');
    console.log('  6. Test mark as test functionality\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();

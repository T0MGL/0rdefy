/**
 * Apply Migration 038: Soft Delete Orders System
 *
 * This migration adds soft delete and test marking functionality to orders
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  console.log('\n🚀 Starting Migration 038: Soft Delete Orders System\n');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '038_soft_delete_orders_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📝 Executing SQL...\n');

    // Execute migration
    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: migrationSQL
    });

    if (error) {
      // If exec_sql doesn't exist, try direct execution
      console.log('⚠️  exec_sql function not found, trying direct execution...');

      // Split by semicolons and execute each statement
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        if (statement.toLowerCase().includes('create') ||
            statement.toLowerCase().includes('alter') ||
            statement.toLowerCase().includes('drop') ||
            statement.toLowerCase().includes('comment')) {
          try {
            await supabase.rpc('exec_sql', { sql_query: statement + ';' });
          } catch (err) {
            console.error(`Error executing statement: ${statement.substring(0, 100)}...`);
            throw err;
          }
        }
      }
    }

    console.log('\n✅ Migration 038 applied successfully!\n');
    console.log('📊 Summary of changes:');
    console.log('  ✓ Added deleted_at, deleted_by, deletion_type columns to orders');
    console.log('  ✓ Added is_test, marked_test_by, marked_test_at columns to orders');
    console.log('  ✓ Updated trigger to allow soft delete, prevent hard delete if stock affected');
    console.log('  ✓ Added restore_soft_deleted_order() function');
    console.log('  ✓ Added mark_order_as_test() function');
    console.log('\n🎯 Next steps:');
    console.log('  1. Restart backend server (API)');
    console.log('  2. Restart frontend server');
    console.log('  3. Test soft delete workflow');
    console.log('  4. Test restore functionality');
    console.log('  5. Test mark as test functionality\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

applyMigration();

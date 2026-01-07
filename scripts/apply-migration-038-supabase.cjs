/**
 * Apply Migration 038: Soft Delete Orders System
 * Uses Supabase REST API to execute SQL
 */

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

async function executeSQL(sql) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SQL execution failed: ${error}`);
  }

  return response.json();
}

async function executeSQLDirect(sql) {
  // Use PostgREST's query parameter for direct SQL execution
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'params=single-object'
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SQL execution failed: ${error}`);
  }

  return response;
}

async function applyMigration() {
  console.log('\n🚀 Starting Migration 038: Soft Delete Orders System\n');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '038_soft_delete_orders_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📝 Preparing to execute SQL...\n');

    // Split SQL into statements and execute one by one
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => {
        // Remove empty statements and comments-only lines
        if (!s) return false;
        if (s.startsWith('--') && !s.includes('\n')) return false;
        return true;
      })
      .map(s => s + ';'); // Add back semicolon

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement using Supabase SQL editor endpoint
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      // Skip comment-only blocks
      if (stmt.trim().startsWith('--') && !stmt.includes('CREATE') && !stmt.includes('ALTER') && !stmt.includes('DROP')) {
        continue;
      }

      // Extract first meaningful word for logging
      const firstLine = stmt.split('\n').find(l => !l.trim().startsWith('--')) || '';
      const preview = firstLine.substring(0, 60).trim();

      console.log(`[${i + 1}/${statements.length}] Executing: ${preview}...`);

      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ sql_query: stmt })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`\n❌ Failed to execute statement ${i + 1}:`);
          console.error('Statement:', preview);
          console.error('Error:', errorText);
          throw new Error(errorText);
        }

        console.log(`  ✓ Success`);
      } catch (error) {
        console.error(`\n❌ Error on statement ${i + 1}:`, error.message);
        throw error;
      }
    }

    console.log('\n✅ Migration 038 applied successfully!\n');
    console.log('📊 Summary of changes:');
    console.log('  ✓ Added deleted_at, deleted_by, deletion_type columns to orders');
    console.log('  ✓ Added is_test, marked_test_by, marked_test_at columns to orders');
    console.log('  ✓ Created indexes for filtering deleted/test orders');
    console.log('  ✓ Added smart_order_deletion_with_stock_restoration() function');
    console.log('  ✓ Added trigger_restore_stock_on_hard_delete trigger');
    console.log('  ✓ Added restore_soft_deleted_order() function');
    console.log('  ✓ Added mark_order_as_test() function');
    console.log('\n🎯 Next steps:');
    console.log('  1. Restart backend server (API)');
    console.log('  2. Restart frontend server');
    console.log('  3. Test soft delete workflow');
    console.log('  4. Test hard delete with stock restoration');
    console.log('  5. Test restore functionality');
    console.log('  6. Test mark as test functionality\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

applyMigration();

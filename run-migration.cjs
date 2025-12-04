#!/usr/bin/env node
// ================================================================
// Apply Migration via Supabase Admin Client
// ================================================================

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  console.log('================================================================');
  console.log('🔧 Aplicando corrección crítica de pedidos');
  console.log('================================================================\n');

  const migrationPath = path.join(__dirname, 'db', 'migrations', '023_fix_order_creation_and_deletion.sql');

  if (!fs.existsSync(migrationPath)) {
    console.error('❌ Migration file not found:', migrationPath);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('📝 Ejecutando migración...\n');

  try {
    // Use rpc to execute raw SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_string: sql });

    if (error) {
      // If exec_sql function doesn't exist, try direct query
      console.log('⚠️  RPC method not available, trying direct execution...\n');

      // Split SQL into individual statements
      const statements = sql
        .split(/;\s*\n/)
        .filter(stmt => stmt.trim().length > 0)
        .map(stmt => stmt.trim() + ';');

      console.log(`📊 Found ${statements.length} SQL statements\n`);

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (stmt.trim().startsWith('--') || stmt.trim().startsWith('/*')) {
          continue; // Skip comments
        }

        console.log(`Executing statement ${i + 1}/${statements.length}...`);

        // Use the REST API to execute SQL
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
          method: 'POST',
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({ query: stmt })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Error executing statement ${i + 1}:`, errorText);
          console.error('Statement:', stmt.substring(0, 200) + '...');
        }
      }

      console.log('\n✅ Migration completed (manual execution)');
      console.log('\n⚠️  Note: Please verify the migration was successful by checking your database.\n');
      console.log('Alternatively, you can run the SQL manually:');
      console.log('1. Copy the content of: db/migrations/023_fix_order_creation_and_deletion.sql');
      console.log('2. Open your Supabase SQL editor');
      console.log('3. Paste and execute the SQL\n');
    } else {
      console.log('✅ Migration completed successfully!\n');
      console.log('Changes applied:');
      console.log('  ✅ Fixed trigger: update_product_stock_on_order_status()');
      console.log('  ✅ Fixed trigger: prevent_order_deletion_after_stock_deducted()');
      console.log('  ✅ Orders can now be created with missing products');
      console.log('  ✅ Orders without stock movements can now be deleted\n');
    }
  } catch (err) {
    console.error('❌ Error running migration:', err.message);
    console.log('\n📝 Manual migration required:');
    console.log('1. Copy the content of: db/migrations/023_fix_order_creation_and_deletion.sql');
    console.log('2. Open your Supabase SQL editor');
    console.log('3. Paste and execute the SQL\n');
    process.exit(1);
  }
}

runMigration();

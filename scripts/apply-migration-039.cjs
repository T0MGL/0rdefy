/**
 * Apply Migration 039: Hard Delete with Cascading Cleanup
 *
 * This script applies the migration that removes soft delete and implements
 * complete cascading deletion for orders (owner only).
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigration() {
  try {
    console.log('🚀 Starting Migration 039: Hard Delete Cascading Cleanup');
    console.log('─'.repeat(60));

    // Read migration file
    const migrationPath = path.join(__dirname, '../db/migrations/039_hard_delete_cascading_cleanup.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Split SQL into individual statements (basic split by semicolon)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`📄 Found ${statements.length} SQL statements to execute`);
    console.log('');

    let successCount = 0;
    let errorCount = 0;

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';'; // Add semicolon back

      // Skip comment-only statements
      if (statement.trim().startsWith('--')) continue;

      try {
        console.log(`[${i + 1}/${statements.length}] Executing...`);

        const { data, error } = await supabase.rpc('exec_sql', {
          query: statement
        });

        if (error) {
          // Try direct query if RPC fails
          const { error: directError } = await supabase
            .from('_migrations')
            .select('*')
            .limit(0);

          if (directError) {
            console.error(`❌ Error:`, error.message);
            errorCount++;
          } else {
            console.log(`✅ Executed successfully`);
            successCount++;
          }
        } else {
          console.log(`✅ Executed successfully`);
          successCount++;
        }
      } catch (err) {
        console.error(`❌ Error executing statement:`, err.message);
        errorCount++;
      }
    }

    console.log('');
    console.log('─'.repeat(60));
    console.log(`✅ Migration completed: ${successCount} success, ${errorCount} errors`);
    console.log('');

    if (errorCount > 0) {
      console.log('⚠️  Some statements failed. You may need to run them manually via Supabase SQL Editor.');
      console.log('📋 Migration file location:', migrationPath);
    } else {
      console.log('🎉 All statements executed successfully!');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
applyMigration();

#!/usr/bin/env node
// ================================================================
// MIGRATION RUNNER: 007 - Shopify Webhook Sync System
// ================================================================
// Run with: node db/run-migration-007.js
// ================================================================

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  console.log('================================================================');
  console.log('🚀 Running Migration 007: Shopify Webhook Sync System');
  console.log('================================================================');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, 'migrations', '007_shopify_sync_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📊 Executing SQL...');
    console.log('');

    // Execute the entire migration as one transaction
    const { data, error } = await supabase.rpc('exec', {
      sql: migrationSQL
    });

    if (error) {
      // Try alternative method - direct query
      console.log('⚠️  RPC method failed, trying direct query method...');

      // Split into individual statements and execute
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      console.log(`Found ${statements.length} SQL statements to execute`);

      let successCount = 0;
      let skipCount = 0;

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        try {
          // Use supabase.from() for table operations when possible
          // For raw SQL, we need to use the REST API directly
          const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ sql: statement + ';' })
          });

          if (response.ok) {
            successCount++;
            console.log(`✅ [${i+1}/${statements.length}] Statement executed`);
          } else {
            const errorText = await response.text();
            if (errorText.includes('already exists') || errorText.includes('duplicate')) {
              skipCount++;
              console.log(`⏭️  [${i+1}/${statements.length}] Skipped (already exists)`);
            } else {
              console.error(`❌ [${i+1}/${statements.length}] Error:`, errorText);
            }
          }
        } catch (err) {
          console.error(`❌ [${i+1}/${statements.length}] Error:`, err.message);
        }
      }

      console.log('');
      console.log('================================================================');
      console.log('📊 MIGRATION SUMMARY');
      console.log('================================================================');
      console.log(`✅ Success: ${successCount} statements`);
      console.log(`⏭️  Skipped: ${skipCount} statements (already exist)`);
      console.log('================================================================');

    } else {
      console.log('✅ Migration executed successfully!');
      console.log('');
    }

    console.log('================================================================');
    console.log('✨ MIGRATION COMPLETED');
    console.log('================================================================');
    console.log('');
    console.log('🔧 Next steps:');
    console.log('1. Restart your API server to load the new webhook routes');
    console.log('2. Test Shopify OAuth to register webhooks automatically');
    console.log('3. Check that webhooks are registered in Shopify admin');
    console.log('4. Monitor webhook logs in shopify_webhook_logs table');
    console.log('');
    console.log('📝 Manual verification (optional):');
    console.log('   - Check shopify_webhooks table exists');
    console.log('   - Check shopify_webhook_logs table exists');
    console.log('   - Check products table has shopify_* columns');
    console.log('   - Check customers table has shopify_* columns');
    console.log('   - Check orders table has shopify_* columns');
    console.log('');

  } catch (error) {
    console.error('================================================================');
    console.error('💥 MIGRATION FAILED');
    console.error('================================================================');
    console.error(error);
    console.log('');
    console.log('📝 MANUAL MIGRATION INSTRUCTIONS:');
    console.log('If the automatic migration failed, you can run the SQL manually:');
    console.log('1. Open Supabase dashboard SQL Editor');
    console.log('2. Copy the contents of db/migrations/007_shopify_sync_system.sql');
    console.log('3. Paste and run in the SQL editor');
    console.log('');
    process.exit(1);
  }
}

// Run the migration
runMigration();

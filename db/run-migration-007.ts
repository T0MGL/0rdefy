#!/usr/bin/env ts-node
// ================================================================
// MIGRATION RUNNER: 007 - Shopify Webhook Sync System
// ================================================================
// Run with: npx ts-node db/run-migration-007.ts
// ================================================================

import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

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
    const migrationPath = join(__dirname, 'migrations', '007_shopify_sync_system.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📊 Executing SQL statements...');

    // Split by statement and execute each one
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const statement of statements) {
      try {
        const { error } = await supabase.rpc('exec_sql', { sql: statement });

        if (error) {
          // Check if error is about already existing objects
          if (error.message.includes('already exists') ||
              error.message.includes('duplicate key') ||
              error.message.includes('column already exists')) {
            console.log(`⏭️  Skipped (already exists)`);
            skipCount++;
          } else {
            throw error;
          }
        } else {
          console.log(`✅ Statement executed successfully`);
          successCount++;
        }
      } catch (err: any) {
        console.error(`❌ Error executing statement:`, err.message);
        console.error(`   SQL: ${statement.substring(0, 100)}...`);
        errorCount++;
      }
    }

    console.log('================================================================');
    console.log('📊 MIGRATION SUMMARY');
    console.log('================================================================');
    console.log(`✅ Success: ${successCount} statements`);
    console.log(`⏭️  Skipped: ${skipCount} statements (already exist)`);
    console.log(`❌ Errors: ${errorCount} statements`);
    console.log('================================================================');

    if (errorCount === 0) {
      console.log('✨ Migration completed successfully!');
      console.log('');
      console.log('🔧 Next steps:');
      console.log('1. Restart your API server to load the new webhook routes');
      console.log('2. Test Shopify OAuth to register webhooks automatically');
      console.log('3. Monitor webhook logs in shopify_webhook_logs table');
    } else {
      console.log('⚠️  Migration completed with errors. Please review the errors above.');
      console.log('   Note: Some errors about existing objects are normal if you\'re re-running the migration.');
    }

  } catch (error: any) {
    console.error('================================================================');
    console.error('💥 MIGRATION FAILED');
    console.error('================================================================');
    console.error(error);
    process.exit(1);
  }
}

// Run the migration
runMigration();

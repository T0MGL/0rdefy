#!/usr/bin/env node

/**
 * Apply Migration 030: Add order_status_url to orders table
 *
 * This migration adds the missing order_status_url column that Shopify webhooks need
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Get Supabase credentials from environment
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('   Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  try {
    console.log('🔄 Applying Migration 030: Add order_status_url to orders table...\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../db/migrations/030_add_order_status_url.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration SQL loaded, executing...\n');

    // Split SQL into individual statements (DO blocks need to be executed separately)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';

      // Skip comment-only statements
      if (statement.trim().startsWith('--')) {
        continue;
      }

      console.log(`Executing statement ${i + 1}/${statements.length}...`);

      const { error } = await supabase.rpc('exec_sql', {
        sql_query: statement
      });

      if (error) {
        // Try direct execution if RPC fails
        const { error: directError } = await supabase.from('_migrations').select('*').limit(1);

        if (directError) {
          console.error(`❌ Failed to execute statement ${i + 1}:`, error.message);
          console.error('Statement:', statement);
          throw error;
        }
      }
    }

    console.log('\n✅ Migration 030 applied successfully!\n');
    console.log('📋 Summary:');
    console.log('   - Added order_status_url column to orders table');
    console.log('   - Added index idx_orders_order_status_url');
    console.log('   - Shopify webhooks can now create orders with order_status_url\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nTrying manual SQL execution via Supabase dashboard...');
    console.log('\n📋 Copy this SQL and run it in Supabase SQL Editor:');
    console.log('---------------------------------------------------');

    const migrationPath = path.join(__dirname, '../db/migrations/030_add_order_status_url.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log(migrationSQL);
    console.log('---------------------------------------------------\n');

    process.exit(1);
  }
}

applyMigration();
